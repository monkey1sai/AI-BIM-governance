import { createPublicKey, verify as verifyEd25519 } from 'node:crypto'

import {
  canonicalize,
  digestCanonical,
  isCanonicalOpaqueReference,
  parseStackDeliveryEnvelope,
} from './parallel-delivery-fabric-contract.mjs'
import {
  planDirectStackDispatch,
  reduceDirectStackDispatch,
  reduceDirectStackPoll,
  reduceStackDeployment,
  verifyOrdinaryDelivery,
} from './parallel-delivery-fabric-stack.mjs'

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const RAW_WINDOWS_SID = /(?:^|[/:])S-\d+(?:-\d+){2,}(?=$|[/:])/iu
const RAW_PROCESS_ID = /(?:^|[/:])\d+$/u
const SECRET_VALUE = /(?:bearer|token|cookie|authorization|private[-_]?key|gh[pousr]_|github_pat_|eyJ[A-Za-z0-9_-]{10,})/iu
const SENSITIVE_KEY = /(?:token|cookie|authorization|private[_-]?key|password|secret|(?:^|_)sid$|(?:^|_)pid$|process[_-]?id|transcript|(?:^|_)env(?:_|$)|environment|absolute[_-]?path)/iu
const ORDINARY_INPUT_KEYS = Object.freeze([
  'schema_version', 'handoff_kind', 'plan', 'candidate', 'roles', 'self_diagnostic',
  'independent_review', 'computer_use_verifier', 'binder', 'check_run', 'observed_activation',
])
const DIRECT_STACK_INPUT_KEYS = Object.freeze([...ORDINARY_INPUT_KEYS, 'stack'])
const AUTHORITY_BUNDLE_KEYS = Object.freeze([
  'schema_version', 'bundle_id', 'issuer', 'source', 'key_id', 'revocation', 'freshness', 'payload_digest', 'payload', 'signature',
])
const AUTHORITY_ISSUER_KEYS = Object.freeze(['issuer_id', 'issuer_version'])
const AUTHORITY_REVOCATION_KEYS = Object.freeze(['epoch', 'revoked'])
const AUTHORITY_FRESHNESS_KEYS = Object.freeze(['issued_at', 'expires_at'])
const AUTHORITY_PAYLOAD_KEYS = Object.freeze([
  'schema_version', 'authority_id', 'repository', 'activation_record', 'checkrun_publisher', 'independent_review',
  'computer_use_verifier', 'binder', 'delivery_sources',
])
const AUTHORITY_PRODUCER_KEYS = Object.freeze([
  'issuer', 'role', 'expected_identity', 'key_id', 'public_key_spki', 'source',
])
const ACTIVATION_RECORD_KEYS = Object.freeze([
  'schema_version', 'phase', 'base_sha', 'policy_digest', 'writer_cap', 'external_check_name', 'external_app_id', 'activated_at',
])
const AUTHORITY_SOURCE_PIN_KEYS = Object.freeze([
  'issuer', 'source_ref', 'source_sha', 'source_digest', 'base_sha', 'immutable', 'base_pinned', 'fresh', 'revoked',
])
const CHECK_SOURCE_KEYS = Object.freeze([
  'app_slug', 'app_id', 'check_name', 'publisher_issuer', ...AUTHORITY_SOURCE_PIN_KEYS,
])
const DELIVERY_SOURCE_PIN_KEYS = Object.freeze([
  'issuer', 'source_reference', 'source_sha', 'source_digest', 'base_sha', 'immutable', 'base_pinned', 'fresh', 'revoked',
])
const DELIVERY_SOURCES_KEYS = Object.freeze([
  'ordinary_replay', 'direct_stack_replay', 'ancestry', 'origin_main', 'deployment', 'postverify',
])
const DELIVERY_ATTESTATION_KEYS = Object.freeze(['ancestry', 'origin_main', 'deployment', 'postverify'])
const SIGNED_RECORD_ENVELOPE_KEYS = Object.freeze([
  'schema_version', 'record_type', 'issuer', 'key_id', 'issued_at', 'expires_at', 'revocation', 'nonce',
  'payload_digest', 'payload', 'signature',
])
const SIGNED_RECORD_REVOCATION_KEYS = Object.freeze(['epoch', 'revoked'])
const RECORD_TYPES = deepFreeze({
  independent_review: 'independent_review',
  computer_use_verifier: 'computer_use_verifier',
  binder: 'binder',
  checkrun_publisher: 'check_run',
  ordinary_replay: 'ordinary_replay',
  direct_stack_replay: 'direct_stack_replay',
  ancestry: 'delivery_ancestry',
  origin_main: 'delivery_origin_main',
  deployment: 'delivery_deployment',
  postverify: 'delivery_postverify',
})
const PRODUCER_ROLES = deepFreeze({
  independent_review: 'independent_reviewer',
  computer_use_verifier: 'computer_use_verifier',
  binder: 'binder',
  checkrun_publisher: 'checkrun_publisher',
  ordinary_replay: 'deployment_executor',
  direct_stack_replay: 'merge_executor',
  ancestry: 'merge_executor',
  origin_main: 'merge_executor',
  deployment: 'deployment_executor',
  postverify: 'deployment_executor',
})
const PROMOTION_AUTHORITY_KEY_ID = 'ed25519:promotion-authority-vector-2'
const PROMOTION_AUTHORITY_ISSUER = deepFreeze({
  issuer_id: 'issuer:promotion-control-plane',
  issuer_version: 'promotion-authority/v1',
})
const PROMOTION_AUTHORITY_PUBLIC_KEY = createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEA5VZ+pANsU7XvwspyMG898WBOxPuHxxbPSqgHteUkZCg=', 'base64'),
  format: 'der',
  type: 'spki',
})
const PLAN_KEYS = Object.freeze([
  'plan_id', 'generation', 'repository', 'repo_identity_digest', 'base_sha', 'policy_digest',
])
const CANDIDATE_KEYS = Object.freeze([
  'plan_id', 'generation', 'repository', 'repo_identity_digest', 'tuple_digest', 'owner_identity', 'pr_number',
  'base_sha', 'head_sha', 'changed_files_digest', 'scope_digest', 'lease_id', 'execution_context_id', 'worktree_id',
  'worktree_path_digest', 'evidence_digest', 'evidence_refs',
])
const CORRELATION_KEYS = Object.freeze([
  'plan_id', 'generation', 'repository', 'repo_identity_digest', 'base_sha', 'head_sha', 'tuple_digest',
])
const DIRECT_STACK_REQUEST_KEYS = Object.freeze([
  'schema_version', 'stack_id', 'repository', 'trunk_ref', 'trunk_sha', 'selected_top_pr',
  'expected_head_sha', 'merge_action', 'merge_method', 'ordered_member_vector_digest', 'members',
  'expected_protection_digest', 'capability_reference', 'capability_state',
  'deployment_target_reference', 'expected_state', 'cas_precondition',
])
const DIRECT_STACK_OPERATION_KEYS = Object.freeze([
  'schema_version', 'operation_uuid', 'operation_reference', 'stack_id', 'repository', 'request_digest',
  'expected_state_digest', 'ordered_member_vector_digest', 'expected_head_sha',
  'expected_protection_digest', 'capability_reference',
])
const DIRECT_STACK_EXPECTED_STATE_KEYS = Object.freeze([
  'repository', 'trunk_ref', 'trunk_sha', 'selected_top_pr', 'expected_head_sha',
  'ordered_member_vector_digest', 'expected_protection_digest', 'capability_reference', 'capability_state',
])
const DIRECT_STACK_CAS_KEYS = Object.freeze([
  'stack_id', 'repository', 'trunk_sha', 'selected_top_pr', 'expected_head_sha',
  'ordered_member_vector_digest', 'expected_protection_digest', 'capability_reference',
])

const ROLE_CAPABILITIES = deepFreeze({
  writer: ['implement_local', 'open_draft_pr', 'push_owned_branch', 'test'],
  self_diagnostic: ['emit_advisory', 'read_candidate'],
  independent_reviewer: ['emit_findings', 'read_candidate'],
  computer_use_verifier: ['emit_evidence', 'operate_ui'],
  binder: ['bind_evidence'],
  checkrun_publisher: ['publish_checkrun', 'read_checkrun'],
  promotion_bridge: ['assemble_handoff'],
  merge_executor: ['merge_exact_head'],
  deployment_executor: ['deploy_exact_commit'],
})

const exactStringSet = (value, expected) => (
  Array.isArray(value) && value.length === expected.length &&
  new Set(value).size === value.length &&
  [...value].sort().every((entry, index) => entry === [...expected].sort()[index])
)

const fail = (reason) => {
  throw new Error(`promotion_handoff_${reason}`)
}

const recursivelySanitized = (value, depth = 0) => {
  if (depth > 64) return false
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return true
  if (typeof value === 'string') {
    const isDigest = SHA1.test(value) || SHA256.test(value)
    return !RAW_WINDOWS_SID.test(value) && (isDigest || !RAW_PROCESS_ID.test(value)) && !SECRET_VALUE.test(value)
  }
  if (Array.isArray(value)) return value.every((entry) => recursivelySanitized(entry, depth + 1))
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([key, entry]) => !SENSITIVE_KEY.test(key) && recursivelySanitized(entry, depth + 1))
}

const sanitizedCanonicalInput = (raw) => {
  try {
    const value = canonicalize(raw)
    return recursivelySanitized(value) ? value : null
  } catch {
    return null
  }
}

const exactKeys = (value, keys) => isPlainObject(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const equalValue = (left, right) => {
  try {
    return digestCanonical(left) === digestCanonical(right)
  } catch {
    return false
  }
}
const isRepository = (value) => typeof value === 'string' && value.length >= 3 && value.length <= 256 && REPOSITORY.test(value)

const timestampMs = (value) => {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null
}

const validAuthoritySourcePin = (source, baseSha) => exactKeys(source, AUTHORITY_SOURCE_PIN_KEYS) &&
  isCanonicalOpaqueReference(source.issuer) && isCanonicalOpaqueReference(source.source_ref) &&
  SHA1.test(source.source_sha) && SHA256.test(source.source_digest) && source.base_sha === baseSha &&
  source.immutable === true && source.base_pinned === true && source.fresh === true && source.revoked === false

const validPinnedSource = (source, baseSha) => validAuthoritySourcePin(source, baseSha)

const validDeliverySourcePin = (source, baseSha) => exactKeys(source, DELIVERY_SOURCE_PIN_KEYS) &&
  isCanonicalOpaqueReference(source.issuer) && isCanonicalOpaqueReference(source.source_reference) &&
  SHA1.test(source.source_sha) && SHA256.test(source.source_digest) && source.base_sha === baseSha &&
  source.immutable === true && source.base_pinned === true && source.fresh === true && source.revoked === false

const publicKeyFromSpki = (spki) => {
  try {
    if (typeof spki !== 'string' || spki.length < 16) return null
    const encoded = Buffer.from(spki, 'base64')
    if (encoded.length === 0 || encoded.toString('base64') !== spki) return null
    const key = createPublicKey({ key: encoded, format: 'der', type: 'spki' })
    return key.type === 'public' && key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

const validAuthorityProducer = (producer, baseSha, expectedRole, sourceValidator = validAuthoritySourcePin) =>
  exactKeys(producer, AUTHORITY_PRODUCER_KEYS) &&
  isCanonicalOpaqueReference(producer.issuer) && producer.role === expectedRole &&
  isCanonicalOpaqueReference(producer.expected_identity) && isCanonicalOpaqueReference(producer.key_id) &&
  publicKeyFromSpki(producer.public_key_spki) !== null && producer.source?.issuer === producer.issuer &&
  sourceValidator(producer.source, baseSha)

const validDetachedSignature = (envelope, publicKey) => {
  try {
    if (envelope.payload_digest !== digestCanonical(envelope.payload)) return false
    const signature = Buffer.from(envelope.signature, 'base64')
    if (signature.length !== 64 || signature.toString('base64') !== envelope.signature) return false
    const { signature: ignoredSignature, ...signedEnvelope } = envelope
    const signedBytes = Buffer.from(JSON.stringify(canonicalize(signedEnvelope)), 'utf8')
    return verifyEd25519(null, signedBytes, publicKey, signature)
  } catch {
    return false
  }
}

const validAuthoritySignature = (bundle) => {
  return validDetachedSignature(bundle, PROMOTION_AUTHORITY_PUBLIC_KEY)
}

const parseSignedProducerRecord = (raw, producer, recordType) => {
  const record = sanitizedCanonicalInput(raw)
  const now = Date.now()
  const key = producer && publicKeyFromSpki(producer.public_key_spki)
  if (!exactKeys(record, SIGNED_RECORD_ENVELOPE_KEYS) ||
      record.schema_version !== 'parallel-delivery-fabric-signed-record/v1' ||
      record.record_type !== recordType || record.issuer !== producer?.issuer || record.key_id !== producer?.key_id ||
      timestampMs(record.issued_at) === null || timestampMs(record.expires_at) === null ||
      timestampMs(record.issued_at) >= timestampMs(record.expires_at) ||
      timestampMs(record.issued_at) > now || timestampMs(record.expires_at) <= now ||
      !exactKeys(record.revocation, SIGNED_RECORD_REVOCATION_KEYS) ||
      !Number.isSafeInteger(record.revocation.epoch) || record.revocation.epoch < 0 || record.revocation.revoked !== false ||
      !isCanonicalOpaqueReference(record.nonce) || !SHA256.test(record.payload_digest) ||
      typeof record.signature !== 'string' || record.signature.length === 0 || !isPlainObject(record.payload) ||
      key === null || !validDetachedSignature(record, key)) {
    fail('signed_producer_record_invalid')
  }
  return deepFreeze(record)
}

const parseTrustedPromotionAuthorityBundle = (raw) => {
  const bundle = sanitizedCanonicalInput(raw)
  if (!exactKeys(bundle, AUTHORITY_BUNDLE_KEYS) ||
      bundle.schema_version !== 'trusted-promotion-authority-bundle/v1' ||
      !isCanonicalOpaqueReference(bundle.bundle_id) || bundle.key_id !== PROMOTION_AUTHORITY_KEY_ID ||
      !exactKeys(bundle.issuer, AUTHORITY_ISSUER_KEYS) || !equalValue(bundle.issuer, PROMOTION_AUTHORITY_ISSUER) ||
      !exactKeys(bundle.revocation, AUTHORITY_REVOCATION_KEYS) ||
      !Number.isSafeInteger(bundle.revocation.epoch) || bundle.revocation.epoch < 0 || bundle.revocation.revoked !== false ||
      !exactKeys(bundle.freshness, AUTHORITY_FRESHNESS_KEYS) ||
      timestampMs(bundle.freshness.issued_at) === null || timestampMs(bundle.freshness.expires_at) === null ||
      timestampMs(bundle.freshness.issued_at) >= timestampMs(bundle.freshness.expires_at) ||
      timestampMs(bundle.freshness.issued_at) > Date.now() || timestampMs(bundle.freshness.expires_at) <= Date.now() ||
      !SHA256.test(bundle.payload_digest) || typeof bundle.signature !== 'string' || bundle.signature.length === 0 ||
      !exactKeys(bundle.payload, AUTHORITY_PAYLOAD_KEYS)) {
    fail('trusted_authority_bundle_invalid')
  }
  const { payload, source } = bundle
  const activation = payload.activation_record
  if (payload.schema_version !== 'trusted-promotion-authority-payload/v2' ||
      !isCanonicalOpaqueReference(payload.authority_id) || !isRepository(payload.repository) ||
      !exactKeys(activation, ACTIVATION_RECORD_KEYS) ||
      activation.schema_version !== 'parallel-delivery-fabric-activation/v1' ||
      activation.phase !== 'AUTONOMOUS_ACTIVE' || !SHA1.test(activation.base_sha) ||
      !SHA256.test(activation.policy_digest) || activation.writer_cap !== 2 ||
      activation.external_check_name !== 'monkey1sai-codex/ready' || activation.external_app_id !== 481516 ||
      timestampMs(activation.activated_at) === null || timestampMs(activation.activated_at) > Date.now() ||
      !validAuthoritySourcePin(source, activation.base_sha) || source.issuer !== bundle.issuer.issuer_id ||
      !validAuthorityProducer(payload.checkrun_publisher, activation.base_sha, PRODUCER_ROLES.checkrun_publisher) ||
      !validAuthorityProducer(payload.independent_review, activation.base_sha, PRODUCER_ROLES.independent_review) ||
      !validAuthorityProducer(payload.computer_use_verifier, activation.base_sha, PRODUCER_ROLES.computer_use_verifier) ||
      !validAuthorityProducer(payload.binder, activation.base_sha, PRODUCER_ROLES.binder) ||
      !exactKeys(payload.delivery_sources, DELIVERY_SOURCES_KEYS) ||
      DELIVERY_SOURCES_KEYS.some((key) => !validAuthorityProducer(
        payload.delivery_sources[key],
        activation.base_sha,
        PRODUCER_ROLES[key],
        validDeliverySourcePin,
      )) ||
      !validAuthoritySignature(bundle)) {
    fail('trusted_authority_bundle_invalid')
  }
  return deepFreeze(bundle)
}

const trustedCheckSource = (authority) => ({
  app_slug: 'monkey1sai-codex',
  app_id: authority.payload.activation_record.external_app_id,
  check_name: authority.payload.activation_record.external_check_name,
  publisher_issuer: authority.payload.checkrun_publisher.issuer,
  ...authority.payload.checkrun_publisher.source,
})

const validCompletePagination = (pagination) => exactKeys(pagination, [
  'complete', 'expected_count', 'expected_pages', 'observed_count', 'observed_pages',
]) && pagination.complete === true &&
  ['expected_count', 'expected_pages', 'observed_count', 'observed_pages'].every((key) => (
    Number.isSafeInteger(pagination[key]) && pagination[key] >= 1
  )) && pagination.expected_count === pagination.observed_count &&
  pagination.expected_pages === pagination.observed_pages

const validatePlanAndCandidate = (input) => {
  const { plan, candidate } = input
  if (!exactKeys(plan, PLAN_KEYS) ||
      !isCanonicalOpaqueReference(plan.plan_id) || !Number.isSafeInteger(plan.generation) ||
      plan.generation < 1 || !isRepository(plan.repository) || !SHA256.test(plan.repo_identity_digest) ||
      !SHA1.test(plan.base_sha) || !SHA256.test(plan.policy_digest)) {
    fail('plan_invalid')
  }
  if (!exactKeys(candidate, CANDIDATE_KEYS) || !isCanonicalOpaqueReference(candidate.owner_identity) ||
      !Number.isSafeInteger(candidate.pr_number) || candidate.pr_number < 1 ||
      !SHA1.test(candidate.base_sha) || !SHA1.test(candidate.head_sha) ||
      !SHA256.test(candidate.changed_files_digest) || !SHA256.test(candidate.scope_digest) ||
      !SHA256.test(candidate.repo_identity_digest) || !SHA256.test(candidate.tuple_digest) ||
      !isCanonicalOpaqueReference(candidate.lease_id) ||
      !isCanonicalOpaqueReference(candidate.execution_context_id) ||
      !isCanonicalOpaqueReference(candidate.worktree_id) ||
      !SHA256.test(candidate.worktree_path_digest) || !SHA256.test(candidate.evidence_digest) ||
      !Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length < 1 ||
      candidate.evidence_refs.length > 32 || new Set(candidate.evidence_refs).size !== candidate.evidence_refs.length ||
      candidate.evidence_refs.some((reference) => !isCanonicalOpaqueReference(reference)) ||
      !equalValue(candidate.evidence_refs, [...candidate.evidence_refs].sort()) ||
      candidate.evidence_digest !== digestCanonical(candidate.evidence_refs) ||
      candidate.plan_id !== plan.plan_id || candidate.generation !== plan.generation ||
      candidate.repository !== plan.repository || candidate.repo_identity_digest !== plan.repo_identity_digest ||
      candidate.base_sha !== plan.base_sha) {
    fail('candidate_exact_tuple_invalid')
  }
  const { tuple_digest, ...candidateTuple } = candidate
  if (tuple_digest !== digestCanonical(candidateTuple)) fail('candidate_tuple_digest_invalid')
}

const candidateCorrelation = (candidate) => Object.fromEntries(
  CORRELATION_KEYS.map((key) => [key, candidate[key]]),
)

const validEvidenceBinding = (record, candidate) => (
  exactKeys(record.correlation, CORRELATION_KEYS) && equalValue(record.correlation, candidateCorrelation(candidate)) &&
  record.evidence_digest === candidate.evidence_digest && isCanonicalOpaqueReference(record.evidence_ref) &&
  candidate.evidence_refs.includes(record.evidence_ref) && Array.isArray(record.evidence_refs) &&
  equalValue(record.evidence_refs, candidate.evidence_refs)
)

const validDeliveryEvidenceBinding = (record, candidate) => (
  exactKeys(record.correlation, CORRELATION_KEYS) && equalValue(record.correlation, candidateCorrelation(candidate)) &&
  record.evidence_digest === candidate.evidence_digest && Array.isArray(record.evidence_refs) &&
  equalValue(record.evidence_refs, candidate.evidence_refs)
)

const validateRoleSeparation = (input) => {
  if (!isPlainObject(input.roles) || !isPlainObject(input.candidate)) fail('roles_or_candidate_invalid')
  const expectedRoles = Object.keys(ROLE_CAPABILITIES)
  const actualRoles = Object.keys(input.roles).sort()
  if (actualRoles.length !== expectedRoles.length || actualRoles.some((role, index) => role !== expectedRoles.sort()[index])) {
    fail('roles_invalid')
  }
  const identities = []
  for (const roleName of expectedRoles) {
    const role = input.roles[roleName]
    if (!isPlainObject(role) || Object.keys(role).length !== 2 ||
        !isCanonicalOpaqueReference(role.identity) ||
        !exactStringSet(role.capabilities, ROLE_CAPABILITIES[roleName])) {
      fail('role_capabilities_invalid')
    }
    identities.push(role.identity)
  }
  if (new Set(identities).size !== identities.length) fail('role_identity_collision')
  if (input.candidate.owner_identity !== input.roles.writer.identity ||
      input.roles.checkrun_publisher.identity === input.candidate.owner_identity) {
    fail('candidate_owned_publisher_or_writer_invalid')
  }
  if (!exactKeys(input.self_diagnostic, ['identity', 'correlation', 'evidence_digest', 'evidence_refs', 'evidence_ref', 'verdict']) ||
      input.self_diagnostic.identity !== input.roles.self_diagnostic.identity ||
      !validEvidenceBinding(input.self_diagnostic, input.candidate) ||
      input.self_diagnostic.verdict !== 'advisory') {
    fail('self_diagnostic_must_be_advisory')
  }
}

const authorityProducers = (authority) => [
  ['checkrun_publisher', authority.payload.checkrun_publisher],
  ['independent_review', authority.payload.independent_review],
  ['computer_use_verifier', authority.payload.computer_use_verifier],
  ['binder', authority.payload.binder],
  ...DELIVERY_SOURCES_KEYS.map((key) => [key, authority.payload.delivery_sources[key]]),
]

const validateAuthorityRoleBindings = (input, authority) => {
  for (const [name, producer] of authorityProducers(authority)) {
    if (producer.role !== PRODUCER_ROLES[name] || input.roles[producer.role]?.identity !== producer.expected_identity) {
      fail('signed_producer_role_identity_invalid')
    }
  }
}

const validateReviewAndCheck = (input, trustedAuthority) => {
  const { candidate } = input
  const reviewProducer = trustedAuthority.payload.independent_review
  const review = parseSignedProducerRecord(input.independent_review, reviewProducer, RECORD_TYPES.independent_review).payload
  if (!exactKeys(review, [
    'identity', 'correlation', 'source', 'base_sha', 'head_sha', 'changed_files_digest', 'evidence_digest', 'evidence_refs', 'evidence_ref', 'verdict',
    'unresolved_findings', 'pagination', 'read_only',
  ]) || review.identity !== reviewProducer.expected_identity || review.identity !== input.roles.independent_reviewer.identity ||
      review.identity === candidate.owner_identity || review.base_sha !== candidate.base_sha || review.head_sha !== candidate.head_sha ||
      review.changed_files_digest !== candidate.changed_files_digest || review.verdict !== 'clear' ||
      review.unresolved_findings !== 0 || review.read_only !== true || !validEvidenceBinding(review, candidate) ||
      !validPinnedSource(review.source, candidate.base_sha) || review.source.source_sha === candidate.head_sha ||
      !validCompletePagination(review.pagination) ||
      !equalValue(review.source, reviewProducer.source)) {
    fail('independent_review_invalid')
  }
  const verifierProducer = trustedAuthority.payload.computer_use_verifier
  const verifier = parseSignedProducerRecord(
    input.computer_use_verifier,
    verifierProducer,
    RECORD_TYPES.computer_use_verifier,
  ).payload
  if (!exactKeys(verifier, [
    'identity', 'correlation', 'source', 'base_sha', 'head_sha', 'evidence_digest', 'evidence_refs', 'evidence_ref', 'verdict', 'read_only',
  ]) || verifier.identity !== verifierProducer.expected_identity ||
      verifier.identity !== input.roles.computer_use_verifier.identity || verifier.base_sha !== candidate.base_sha || verifier.head_sha !== candidate.head_sha ||
      !validEvidenceBinding(verifier, candidate) || verifier.verdict !== 'passed' || verifier.read_only !== true ||
      !validPinnedSource(verifier.source, candidate.base_sha) ||
      verifier.source.source_sha === candidate.head_sha ||
      !equalValue(verifier.source, verifierProducer.source)) {
    fail('computer_use_verifier_invalid')
  }
  const binderProducer = trustedAuthority.payload.binder
  const binder = parseSignedProducerRecord(input.binder, binderProducer, RECORD_TYPES.binder).payload
  if (!exactKeys(binder, [
    'identity', 'correlation', 'source', 'head_sha', 'evidence_digest', 'evidence_refs', 'evidence_ref', 'promotion_eligible',
    'verification_mode', 'candidate_harness_status',
  ]) || binder.identity !== binderProducer.expected_identity || binder.identity !== input.roles.binder.identity ||
      binder.head_sha !== candidate.head_sha || !validEvidenceBinding(binder, candidate) ||
      binder.promotion_eligible !== true || binder.verification_mode !== 'canonical' ||
      binder.candidate_harness_status !== 'unchanged' ||
      !validPinnedSource(binder.source, candidate.base_sha) || binder.source.source_sha === candidate.head_sha ||
      !equalValue(binder.source, binderProducer.source)) {
    fail('binder_invalid')
  }
  const activation = trustedAuthority.payload.activation_record
  if (trustedAuthority.payload.repository !== input.plan.repository ||
      activation.base_sha !== candidate.base_sha ||
      activation.policy_digest !== input.plan.policy_digest ||
      trustedAuthority.payload.checkrun_publisher.source.source_sha === candidate.head_sha ||
      !exactKeys(input.observed_activation, ACTIVATION_RECORD_KEYS) ||
      !equalValue(input.observed_activation, activation)) {
    fail('trusted_activation_binding_invalid')
  }
  const checkProducer = trustedAuthority.payload.checkrun_publisher
  const check = parseSignedProducerRecord(input.check_run, checkProducer, RECORD_TYPES.checkrun_publisher).payload
  if (!exactKeys(check, [
    'check_run_id', 'publisher_identity', 'publisher_issuer', 'correlation', 'evidence_digest', 'evidence_refs', 'evidence_ref', 'source',
    'head_sha', 'status', 'conclusion', 'required', 'pagination',
  ]) || check.publisher_identity !== checkProducer.expected_identity ||
      check.publisher_identity !== input.roles.checkrun_publisher.identity ||
      check.publisher_issuer !== checkProducer.issuer ||
      !Number.isSafeInteger(check.check_run_id) || check.check_run_id < 1 ||
      check.head_sha !== candidate.head_sha || check.status !== 'completed' || check.conclusion !== 'success' ||
      check.required !== true || !validEvidenceBinding(check, candidate) || !validCompletePagination(check.pagination) ||
      !exactKeys(check.source, CHECK_SOURCE_KEYS) ||
      !equalValue(check.source, trustedCheckSource(trustedAuthority))) {
    fail('required_check_invalid')
  }
}

const validateDirectStack = (input, trustedAuthority) => {
  let stack
  try {
    stack = parseStackDeliveryEnvelope(input.stack)
  } catch {
    fail('direct_stack_invalid')
  }
  if (stack.ordered_member_vector_digest !== digestCanonical(stack.members)) {
    fail('direct_stack_vector_digest_invalid')
  }
  const top = stack.members.at(-1)
  if (stack.selected_top_pr !== input.candidate.pr_number ||
      top.pr_number !== input.candidate.pr_number ||
      top.head_sha !== input.candidate.head_sha ||
      top.direct_base_sha !== input.candidate.base_sha) {
    fail('direct_stack_candidate_tuple_invalid')
  }
  for (let index = 0; index < stack.members.length; index += 1) {
    const member = stack.members[index]
    if (index === 0) {
      if (member.direct_base_ref !== stack.trunk_ref || member.direct_base_sha !== stack.trunk_sha) {
        fail('direct_stack_trunk_base_invalid')
      }
      continue
    }
    const predecessor = stack.members[index - 1]
    if (member.direct_base_ref !== predecessor.head_ref || member.direct_base_sha !== predecessor.head_sha) {
      fail('direct_stack_non_linear_vector')
    }
  }
  if (trustedAuthority.payload.activation_record.writer_cap !== 2 ||
      trustedAuthority.payload.activation_record.phase !== 'AUTONOMOUS_ACTIVE') {
    fail('direct_stack_authority_unavailable')
  }
  return stack
}

const expectedDirectStackState = (handoff) => {
  const { stack } = handoff
  return {
    repository: handoff.plan.repository,
    trunk_ref: stack.trunk_ref,
    trunk_sha: stack.trunk_sha,
    selected_top_pr: stack.selected_top_pr,
    expected_head_sha: stack.members.at(-1).head_sha,
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
    capability_state: 'enabled',
  }
}

const expectedDirectStackCas = (handoff) => {
  const { stack } = handoff
  return {
    stack_id: stack.stack_id,
    repository: handoff.plan.repository,
    trunk_sha: stack.trunk_sha,
    selected_top_pr: stack.selected_top_pr,
    expected_head_sha: stack.members.at(-1).head_sha,
    ordered_member_vector_digest: stack.ordered_member_vector_digest,
    expected_protection_digest: stack.expected_protection_digest,
    capability_reference: stack.capability_reference,
  }
}

const validateDirectStackRequest = (request, handoff) => {
  const { stack } = handoff
  if (!exactKeys(request, DIRECT_STACK_REQUEST_KEYS) ||
      request.schema_version !== 'direct-stack-request/v1' ||
      !isRepository(request.repository) ||
      request.stack_id !== stack.stack_id ||
      request.repository !== handoff.plan.repository ||
      request.trunk_ref !== stack.trunk_ref ||
      request.trunk_sha !== stack.trunk_sha ||
      request.selected_top_pr !== stack.selected_top_pr ||
      request.expected_head_sha !== stack.members.at(-1).head_sha ||
      request.merge_action !== stack.merge_action ||
      request.merge_method !== stack.merge_method ||
      request.ordered_member_vector_digest !== stack.ordered_member_vector_digest ||
      !equalValue(request.members, stack.members) ||
      request.expected_protection_digest !== stack.expected_protection_digest ||
      request.capability_reference !== stack.capability_reference ||
      request.capability_state !== 'enabled' ||
      request.deployment_target_reference !== stack.deployment_target_reference ||
      !exactKeys(request.expected_state, DIRECT_STACK_EXPECTED_STATE_KEYS) ||
      !equalValue(request.expected_state, expectedDirectStackState(handoff)) ||
      !exactKeys(request.cas_precondition, DIRECT_STACK_CAS_KEYS) ||
      !equalValue(request.cas_precondition, expectedDirectStackCas(handoff))) {
    fail('direct_stack_request_invalid')
  }
}

const validateDirectStackOperation = (operation, request, handoff) => {
  const { stack } = handoff
  if (!exactKeys(operation, DIRECT_STACK_OPERATION_KEYS) ||
      operation.schema_version !== 'direct-stack-operation/v1' ||
      typeof operation.operation_uuid !== 'string' || !UUID.test(operation.operation_uuid) ||
      !isCanonicalOpaqueReference(operation.operation_reference) ||
      operation.stack_id !== stack.stack_id ||
      operation.repository !== handoff.plan.repository ||
      operation.request_digest !== digestCanonical(request) ||
      operation.expected_state_digest !== digestCanonical(request.expected_state) ||
      operation.ordered_member_vector_digest !== stack.ordered_member_vector_digest ||
      operation.expected_head_sha !== stack.members.at(-1).head_sha ||
      operation.expected_protection_digest !== stack.expected_protection_digest ||
      operation.capability_reference !== stack.capability_reference) {
    fail('direct_stack_operation_invalid')
  }
}

const heldTerminal = (reasonCode = 'PREMERGE_EVIDENCE_INVALID') => ({
  phase: 'CLOSED', terminal_class: 'HELD', reason_code: reasonCode,
})

const terminalFromTask7 = (outcome) => {
  if (!isPlainObject(outcome) || outcome.phase !== 'CLOSED') return heldTerminal('MERGE_OUTCOME_UNVERIFIED')
  if (outcome.internal_state === 'STACK_DELIVERY_VERIFIED' || outcome.internal_state === 'ORDINARY_DELIVERY_VERIFIED') {
    return { phase: 'CLOSED', terminal_class: 'DELIVERED', reason_code: 'DELIVERY_VERIFIED' }
  }
  if (outcome.internal_state === 'STACK_DELIVERY_FAILED') {
    return { phase: 'CLOSED', terminal_class: 'FAILED', reason_code: 'MERGED_NOT_DELIVERED' }
  }
  if (['MERGE_OUTCOME_UNVERIFIED', 'PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE', 'POLICY_OR_SETTINGS_DRIFT'].includes(outcome.internal_state)) {
    return heldTerminal(outcome.internal_state)
  }
  return heldTerminal('PREMERGE_EVIDENCE_INVALID')
}

const verifiedDeliveryPayload = (raw, producerName, handoff) => {
  const producer = handoff.trusted_authority_bundle.payload.delivery_sources[producerName]
  const record = parseSignedProducerRecord(raw, producer, RECORD_TYPES[producerName])
  const payload = record.payload
  if (payload.identity !== producer.expected_identity ||
      payload.identity !== handoff.roles[producer.role]?.identity ||
      !validDeliveryEvidenceBinding(payload, handoff.candidate)) {
    fail('signed_delivery_record_binding_invalid')
  }
  return payload
}

const matchingDeliveryPin = (attestation, pin) => (
  attestation.issuer === pin.issuer && attestation.source_reference === pin.source_reference &&
  attestation.source_sha === pin.source_sha && attestation.source_digest === pin.source_digest &&
  attestation.base_sha === pin.base_sha && attestation.immutable === true && attestation.base_pinned === true &&
  attestation.fresh === true && attestation.revoked === false
)

const validDirectSourceAttestations = (attestations, merged, deployment, handoff) => {
  if (!exactKeys(attestations, DELIVERY_ATTESTATION_KEYS)) return false
  const ancestry = verifiedDeliveryPayload(attestations.ancestry, 'ancestry', handoff)
  const originMain = verifiedDeliveryPayload(attestations.origin_main, 'origin_main', handoff)
  const deploymentAttestation = verifiedDeliveryPayload(attestations.deployment, 'deployment', handoff)
  const postverify = verifiedDeliveryPayload(attestations.postverify, 'postverify', handoff)
  const deliverySources = handoff.trusted_authority_bundle.payload.delivery_sources
  return exactKeys(ancestry, [
    'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
    'repository', 'stack_id', 'commit_sha', 'frozen_vector_digest', 'proof_digests',
  ]) && matchingDeliveryPin(ancestry, deliverySources.ancestry.source) &&
    ancestry.repository === merged.repository && ancestry.stack_id === merged.stack_id &&
    ancestry.commit_sha === merged.stack_result_merge_commit_sha &&
    ancestry.frozen_vector_digest === merged.frozen_vector_digest && Array.isArray(ancestry.proof_digests) &&
    equalValue(ancestry.proof_digests, merged.ancestry.map((proof) => proof.proof_digest)) &&
    ancestry.proof_digests.every((proofDigest) => proofDigest === deliverySources.ancestry.source.source_digest) &&
    exactKeys(originMain, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'trunk_ref', 'commit_sha', 'authoritative',
  ]) && matchingDeliveryPin(originMain, deliverySources.origin_main.source) &&
    originMain.observed_at === merged.fresh_origin_main.observed_at && originMain.repository === merged.repository &&
    originMain.trunk_ref === merged.fresh_origin_main.trunk_ref &&
    originMain.commit_sha === merged.stack_result_merge_commit_sha && originMain.authoritative === true &&
    originMain.source_reference === merged.fresh_origin_main.source_reference &&
    exactKeys(deploymentAttestation, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'deployment_target_reference', 'command_state',
      'deployed_commit_sha', 'post_deploy_status', 'group_verification_digest',
  ]) && matchingDeliveryPin(deploymentAttestation, deliverySources.deployment.source) &&
    deploymentAttestation.observed_at === deployment.observed_at && deploymentAttestation.repository === merged.repository &&
    deploymentAttestation.deployment_target_reference === deployment.deployment_target_reference &&
    deploymentAttestation.command_state === deployment.command_state &&
    deploymentAttestation.deployed_commit_sha === deployment.deployed_commit_sha &&
    deploymentAttestation.post_deploy_status === deployment.post_deploy_status &&
    deploymentAttestation.group_verification_digest === deployment.group_verification_digest &&
    deployment.group_verification_digest === deliverySources.postverify.source.source_digest &&
    exactKeys(postverify, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'deployed_commit_sha', 'status', 'verification_digest',
  ]) && matchingDeliveryPin(postverify, deliverySources.postverify.source) &&
    postverify.observed_at === deployment.observed_at && postverify.repository === merged.repository &&
    postverify.deployed_commit_sha === deployment.deployed_commit_sha &&
    postverify.status === deployment.post_deploy_status && postverify.verification_digest === deployment.group_verification_digest &&
    postverify.verification_digest === deliverySources.postverify.source.source_digest
}

const validateDirectStackProjection = (directStack, handoff) => {
  try {
    const signedReplay = verifiedDeliveryPayload(directStack, 'direct_stack_replay', handoff)
    if (!exactKeys(signedReplay, ['identity', 'correlation', 'evidence_refs', 'evidence_digest', 'task7_replay']) ||
        !exactKeys(signedReplay.task7_replay, [
      'correlation', 'evidence_refs', 'evidence_digest', 'observation', 'plan', 'response', 'accepted', 'poll',
      'merged', 'deployment', 'source_attestations',
    ])) return heldTerminal()
    const replay = signedReplay.task7_replay
    if (replay.deployment?.command_state === 'failed' || replay.deployment?.post_deploy_status === 'failed') {
      const plan = planDirectStackDispatch({
        stack: handoff.stack,
        repository: handoff.plan.repository,
        observation: replay.observation,
      })
      const accepted = reduceDirectStackDispatch({ plan, response: replay.response })
      const merged = reduceDirectStackPoll({ plan, accepted, poll: replay.poll })
      return terminalFromTask7(reduceStackDeployment({ merged, deployment: replay.deployment }))
    }
    if (!validDeliveryEvidenceBinding(replay, handoff.candidate)) return heldTerminal()
    const plan = planDirectStackDispatch({
      stack: handoff.stack,
      repository: handoff.plan.repository,
      observation: replay.observation,
    })
    if (plan.phase !== 'READY_TO_MERGE' || plan.internal_state !== 'STACK_REQUEST_READY') return terminalFromTask7(plan)
    if (!equalValue(replay.plan, plan)) return heldTerminal()
    const accepted = reduceDirectStackDispatch({ plan, response: replay.response })
    if (accepted.phase !== 'MERGING' || accepted.internal_state !== 'MERGE_ASYNC_DISPATCHED') return terminalFromTask7(accepted)
    if (!equalValue(replay.accepted, accepted)) return heldTerminal()
    const merged = reduceDirectStackPoll({ plan, accepted, poll: replay.poll })
    if (merged.phase !== 'MERGED' || merged.internal_state !== 'STACK_MERGED_PENDING_DEPLOY') return terminalFromTask7(merged)
    if (replay.deployment?.command_state === 'failed' || replay.deployment?.post_deploy_status === 'failed') {
      return terminalFromTask7(reduceStackDeployment({ merged, deployment: replay.deployment }))
    }
    if (!equalValue(replay.merged, merged)) return heldTerminal()
    if (!validDirectSourceAttestations(replay.source_attestations, merged, replay.deployment, handoff)) {
      return heldTerminal()
    }
    return terminalFromTask7(reduceStackDeployment({ merged, deployment: replay.deployment }))
  } catch {
    const replay = isPlainObject(directStack) && isPlainObject(directStack.payload)
      ? directStack.payload.task7_replay
      : sanitizedCanonicalInput(directStack)?.payload?.task7_replay
    if (replay?.deployment?.command_state === 'failed' || replay?.deployment?.post_deploy_status === 'failed') {
      const expectedDigest = handoff?.trusted_authority_bundle?.payload?.delivery_sources?.postverify?.source?.source_digest
      const observedDigest = replay?.source_attestations?.postverify?.payload?.source_digest
      if (typeof expectedDigest === 'string' && observedDigest !== expectedDigest) return heldTerminal()
      return deepFreeze({ phase: 'CLOSED', terminal_class: 'FAILED', reason_code: 'MERGED_NOT_DELIVERED' })
    }
    if (replay?.poll?.status === 'timeout' || (isPlainObject(replay?.merged) && Object.keys(replay.merged).length === 0)) {
      return heldTerminal('MERGE_OUTCOME_UNVERIFIED')
    }
    if (replay?.observation?.capability_state && replay.observation.capability_state !== 'enabled') {
      return heldTerminal('PREMERGE_AUTHORITY_UNAVAILABLE')
    }
    if (replay?.deployment?.command_state === 'completed' && replay.deployment.deployed_commit_sha &&
        replay.merged?.stack_result_merge_commit_sha &&
        replay.deployment.deployed_commit_sha !== replay.merged.stack_result_merge_commit_sha) {
      const attestedSha = replay?.source_attestations?.deployment?.payload?.deployed_commit_sha
      if (attestedSha && attestedSha !== replay.deployment.deployed_commit_sha) return heldTerminal()
      return heldTerminal('POLICY_OR_SETTINGS_DRIFT')
    }
    return heldTerminal()
  }
}

const validOrdinarySourceAttestations = (attestations, observation, handoff) => {
  if (!exactKeys(attestations, DELIVERY_ATTESTATION_KEYS)) return false
  const ancestry = verifiedDeliveryPayload(attestations.ancestry, 'ancestry', handoff)
  const originMain = verifiedDeliveryPayload(attestations.origin_main, 'origin_main', handoff)
  const deployment = verifiedDeliveryPayload(attestations.deployment, 'deployment', handoff)
  const postverify = verifiedDeliveryPayload(attestations.postverify, 'postverify', handoff)
  const deliverySources = handoff.trusted_authority_bundle.payload.delivery_sources
  return exactKeys(ancestry, [
    'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
    'repository', 'pr_number', 'head_sha', 'merge_commit_sha', 'reachable', 'proof_digest',
  ]) && matchingDeliveryPin(ancestry, deliverySources.ancestry.source) &&
    ancestry.repository === observation.repository && ancestry.pr_number === observation.pr_number &&
    ancestry.head_sha === observation.head_sha && ancestry.merge_commit_sha === observation.merge_commit_sha &&
    ancestry.reachable === true && ancestry.proof_digest === observation.head_reachability_digest &&
    ancestry.proof_digest === deliverySources.ancestry.source.source_digest &&
    exactKeys(originMain, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'trunk_ref', 'commit_sha', 'authoritative',
  ]) && matchingDeliveryPin(originMain, deliverySources.origin_main.source) &&
    originMain.observed_at === observation.fresh_origin_main?.observed_at && originMain.repository === observation.repository &&
    originMain.trunk_ref === 'main' && originMain.commit_sha === observation.merge_commit_sha && originMain.authoritative === true &&
    originMain.source_reference === observation.fresh_origin_main?.source_reference &&
    exactKeys(deployment, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'deployed_commit_sha', 'command_state', 'post_deploy_status',
  ]) && matchingDeliveryPin(deployment, deliverySources.deployment.source) &&
    deployment.observed_at === observation.observed_at && deployment.repository === observation.repository &&
    deployment.deployed_commit_sha === observation.deployed_commit_sha && deployment.command_state === 'completed' &&
    deployment.post_deploy_status === (observation.post_deploy_verified ? 'passed' : 'failed') &&
    exactKeys(postverify, [
      'identity', 'correlation', 'evidence_refs', 'evidence_digest', ...DELIVERY_SOURCE_PIN_KEYS,
      'observed_at', 'repository', 'deployed_commit_sha', 'status', 'verification_digest',
  ]) && matchingDeliveryPin(postverify, deliverySources.postverify.source) &&
    postverify.observed_at === observation.observed_at && postverify.repository === observation.repository &&
    postverify.deployed_commit_sha === observation.deployed_commit_sha &&
    postverify.status === deployment.post_deploy_status && postverify.verification_digest === observation.post_deploy_verification_digest &&
    postverify.verification_digest === deliverySources.postverify.source.source_digest
}

const validateOrdinaryProjection = (ordinary, handoff) => {
  try {
    const signedReplay = verifiedDeliveryPayload(ordinary, 'ordinary_replay', handoff)
    if (!exactKeys(signedReplay, ['identity', 'correlation', 'evidence_refs', 'evidence_digest', 'observation', 'source_attestations']) ||
        !isPlainObject(signedReplay.observation)) return heldTerminal()
    const observation = signedReplay.observation
    if (observation.repository !== handoff.plan.repository || observation.pr_number !== handoff.candidate.pr_number ||
        observation.head_sha !== handoff.candidate.head_sha ||
        !validOrdinarySourceAttestations(signedReplay.source_attestations, observation, handoff)) {
      return heldTerminal()
    }
    return terminalFromTask7(verifyOrdinaryDelivery(observation))
  } catch {
    return heldTerminal()
  }
}

export const PROMOTION_BRIDGE_CAPABILITIES = deepFreeze({
  can_access_secrets: false,
  can_approve_review: false,
  can_deploy: false,
  can_merge: false,
  can_modify_protection: false,
  can_open_non_draft_pr: false,
  can_push: false,
})

/**
 * Build a sanitized, immutable handoff for an already-proven candidate.
 * This pure boundary never performs GitHub, deployment, or credential IO.
 */
const buildPromotionHandoffStrict = (input = undefined, trustedAuthorityBundle = undefined) => {
  const sanitized = sanitizedCanonicalInput(input)
  const trusted = parseTrustedPromotionAuthorityBundle(trustedAuthorityBundle)
  if (sanitized === null ||
      sanitized.schema_version !== 'parallel-delivery-fabric-promotion-request/v2' ||
      !['ordinary_single_pr', 'direct_stack_vector'].includes(sanitized.handoff_kind) ||
      !exactKeys(sanitized, sanitized.handoff_kind === 'ordinary_single_pr'
        ? ORDINARY_INPUT_KEYS
        : DIRECT_STACK_INPUT_KEYS)) fail('input_invalid')
  validatePlanAndCandidate(sanitized)
  validateRoleSeparation(sanitized)
  validateAuthorityRoleBindings(sanitized, trusted)
  validateReviewAndCheck(sanitized, trusted)
  const stack = sanitized.handoff_kind === 'direct_stack_vector' ? validateDirectStack(sanitized, trusted) : undefined
  return deepFreeze({
    schema_version: 'parallel-delivery-fabric-promotion-handoff/v4',
    handoff_kind: sanitized.handoff_kind,
    plan: sanitized.plan,
    candidate: sanitized.candidate,
    roles: sanitized.roles,
    self_diagnostic: sanitized.self_diagnostic,
    independent_review: sanitized.independent_review,
    computer_use_verifier: sanitized.computer_use_verifier,
    binder: sanitized.binder,
    check_run: sanitized.check_run,
    observed_activation: sanitized.observed_activation,
    trusted_authority_bundle: trusted,
    ...(stack === undefined ? {} : { stack }),
  })
}

/**
 * Project a fully proven direct-stack reducer result into the external terminal vocabulary.
 * It deliberately accepts a complete, frozen context rather than a bare internal state.
 */
const projectPromotionTerminalStrict = (input = undefined, trustedAuthorityBundle = undefined) => {
  const sanitized = sanitizedCanonicalInput(input)
  const hasDirectStack = exactKeys(sanitized, ['handoff', 'direct_stack'])
  const hasOrdinary = exactKeys(sanitized, ['handoff', 'ordinary'])
  if (sanitized === null || (!hasDirectStack && !hasOrdinary)) {
    fail('projection_input_invalid')
  }
  if (!isPlainObject(sanitized.handoff) ||
      sanitized.handoff.schema_version !== 'parallel-delivery-fabric-promotion-handoff/v4') {
    fail('projection_handoff_invalid')
  }
  const { trusted_authority_bundle, authority_use, schema_version, ...candidateHandoff } = sanitized.handoff
  const rebuilt = buildPromotionHandoffStrict({
    ...candidateHandoff,
    schema_version: 'parallel-delivery-fabric-promotion-request/v2',
  }, trustedAuthorityBundle)
  if (authority_use !== undefined || schema_version !== 'parallel-delivery-fabric-promotion-handoff/v4' ||
      !equalValue(trusted_authority_bundle, rebuilt.trusted_authority_bundle) || !equalValue(sanitized.handoff, rebuilt)) {
    fail('projection_trusted_authority_binding_invalid')
  }
  const handoff = rebuilt
  if (handoff.handoff_kind === 'direct_stack_vector' && hasDirectStack) {
    return deepFreeze(validateDirectStackProjection(sanitized.direct_stack, handoff))
  }
  if (handoff.handoff_kind === 'ordinary_single_pr' && hasOrdinary) {
    return deepFreeze(validateOrdinaryProjection(sanitized.ordinary, handoff))
  }
  fail('projection_handoff_kind_invalid')
}

const trustedAuthorityAvailable = (trustedAuthorityBundle) => {
  try {
    parseTrustedPromotionAuthorityBundle(trustedAuthorityBundle)
    return true
  } catch {
    return false
  }
}

const safeHeldTerminal = (reasonCode) => deepFreeze(heldTerminal(reasonCode))

/**
 * Shadow factory. Until an independently authenticated authority-use consumer
 * is externally activated, candidate-supplied ports are inert and no live
 * handoff packet can be minted.
 */
export function createPromotionBridge(_ports = undefined) {
  const buildHeld = (input = undefined, trustedAuthorityBundle = undefined) => {
    const authorityAvailable = trustedAuthorityAvailable(trustedAuthorityBundle)
    if (!authorityAvailable) return safeHeldTerminal('PREMERGE_AUTHORITY_UNAVAILABLE')
    try {
      buildPromotionHandoffStrict(input, trustedAuthorityBundle)
    } catch {
      return safeHeldTerminal('PREMERGE_EVIDENCE_INVALID')
    }
    return safeHeldTerminal('PREMERGE_AUTHORITY_UNAVAILABLE')
  }
  return Object.freeze({ buildPromotionHandoff: buildHeld })
}

/**
 * Legacy public export. Without a bound authority-use port this seam cannot
 * mint a handoff; it only reports the missing base-owned authority.
 */
export function buildPromotionHandoff(input = undefined, trustedAuthorityBundle = undefined) {
  const authorityAvailable = trustedAuthorityAvailable(trustedAuthorityBundle)
  if (!authorityAvailable) return safeHeldTerminal('PREMERGE_AUTHORITY_UNAVAILABLE')
  try {
    buildPromotionHandoffStrict(input, trustedAuthorityBundle)
  } catch {
    return safeHeldTerminal('PREMERGE_EVIDENCE_INVALID')
  }
  return safeHeldTerminal('PREMERGE_AUTHORITY_UNAVAILABLE')
}

/**
 * Exception-safe external projector. It never retries or invokes an external sink.
 */
export function projectPromotionTerminal(input = undefined, trustedAuthorityBundle = undefined) {
  const authorityAvailable = trustedAuthorityAvailable(trustedAuthorityBundle)
  try {
    return deepFreeze(projectPromotionTerminalStrict(input, trustedAuthorityBundle))
  } catch {
    return safeHeldTerminal(authorityAvailable ? 'PREMERGE_EVIDENCE_INVALID' : 'PREMERGE_AUTHORITY_UNAVAILABLE')
  }
}
