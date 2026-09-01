import {
  canonicalJson,
  parseTerminalRecord,
  sha256,
  validateAttemptAppend,
} from './autonomous-delivery-contract.mjs'

export class LinuxContinuousDeploymentError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'LinuxContinuousDeploymentError'
    this.code = code
  }
}

const STATES = Object.freeze([
  'TRUSTED_MERGED',
  'BUILD_IMMUTABLE_ARTIFACT',
  'VERIFY_ARTIFACT_PROVENANCE',
  'RESOLVE_DEPLOYMENT_TARGET',
  'PRE_DEPLOY_CHECK',
  'DEPLOY_CANARY',
  'VERIFY_HEALTH_SMOKE_E2E',
  'PROMOTE',
  'POST_DEPLOY_VERIFY',
  'ACTIVATED',
  'TERMINAL_DELIVERY_ATTESTATION',
  'PROVISIONING_REQUIRED',
  'ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT',
  'VERIFY_ROLLBACK',
  'ROLLED_BACK',
  'HELD',
])

const SUCCESS_PATH = Object.freeze(STATES.slice(0, 11))
const FINAL_STATES = Object.freeze(['ACTIVATED', 'ROLLED_BACK', 'HELD'])
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
const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const EXPECTED_REPOSITORY = 'monkey1sai/AI-BIM-governance'
const EXPECTED_TARGET_ID = 'canonical-linux'
const ALLOWED_RETRY_CLASSES = Object.freeze(['network_transient'])
const REQUIRED_VERIFICATION_GATES = Object.freeze(['health', 'smoke', 'e2e'])
const PROHIBITED_TARGET_KEYS = /^(?:host|hostname|ip|address|user|username|password|secret|token|private_key|ssh_key|inventory_path|deploy_root|runtime_data_root)$/iu
const SECRET_VALUE = /(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|secret|token)\s*[=:]\s*\S+)/iu

export const linuxContinuousDeploymentVocabulary = Object.freeze({
  states: STATES,
  successPath: SUCCESS_PATH,
  finalStates: FINAL_STATES,
  terminalClasses: TERMINAL_CLASSES,
  reasonCodes: REASON_CODES,
  requiredVerificationGates: REQUIRED_VERIFICATION_GATES,
  deploymentMethod: 'scripts/dev/rebuild-test-deploy.ps1 -Build',
})

const fail = (code, message) => {
  throw new LinuxContinuousDeploymentError(code, message)
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const exactKeys = (value, keys, code = 'invalid_shape') => {
  if (!isObject(value)) fail(code, 'expected an object')
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(code, `expected keys ${expected.join(',')}, got ${actual.join(',')}`)
  }
}

const text = (value, name, pattern = IDENTIFIER) => {
  if (typeof value !== 'string' || !pattern.test(value)) fail('invalid_value', `${name} is invalid`)
  return value
}

const digest = (value, name) => text(value, name, SHA256)
const oid = (value, name) => text(value, name, SHA1)

const timestamp = (value, name) => {
  text(value, name, UTC_TIMESTAMP)
  if (Number.isNaN(Date.parse(value))) fail('invalid_value', `${name} is not a timestamp`)
  return value
}

const safeInteger = (value, name, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) fail('invalid_value', `${name} is invalid`)
  return value
}

const cloneFrozen = (value) => {
  const cloned = structuredClone(value)
  const freeze = (item) => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      for (const nested of Object.values(item)) freeze(nested)
      Object.freeze(item)
    }
    return item
  }
  return freeze(cloned)
}

const assertNoSecretValues = (value, path = '$') => {
  if (typeof value === 'string' && SECRET_VALUE.test(value)) {
    fail('secret_or_topology_detected', `secret-like value at ${path}`)
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretValues(item, `${path}[${index}]`))
  } else if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      assertNoSecretValues(nested, `${path}.${key}`)
    }
  }
}

const assertNoTargetTopology = (value, path = '$') => {
  if (!isObject(value)) return
  for (const [key, nested] of Object.entries(value)) {
    if (PROHIBITED_TARGET_KEYS.test(key)) {
      fail('secret_or_topology_detected', `private topology key at ${path}.${key}`)
    }
    if (isObject(nested)) assertNoTargetTopology(nested, `${path}.${key}`)
  }
}

const terminalClassForState = (state) => ({
  ACTIVATED: 'DELIVERED',
  ROLLED_BACK: 'FAILED',
  HELD: 'HELD',
})[state]

const terminalReasonForError = (error, states = []) => {
  const code = error instanceof LinuxContinuousDeploymentError ? error.code : 'unexpected_contract_failure'
  if (['rollback_unavailable', 'rollback_unverified'].includes(code)) return 'ACTIVATION_UNATTESTED'
  if (['credential_authority_unavailable', 'target_authority_invalid', 'target_profile_invalid',
    'target_fingerprint_drift', 'deployment_method_invalid', 'known_good_target_mismatch',
    'known_good_unavailable', 'external_authority_unavailable'].includes(code)) {
    return 'DEPLOYMENT_BLOCKED'
  }
  if (['duplicate_controller', 'replay_detected'].includes(code)) return 'DEPLOYMENT_BLOCKED'
  if (['retry_budget_exhausted', 'retry_evidence_unchanged'].includes(code)) return 'DEPLOYMENT_BLOCKED'
  return states.includes('TRUSTED_MERGED') ? 'POLICY_OR_SETTINGS_DRIFT' : 'PREMERGE_EVIDENCE_INVALID'
}

const failureDetailFor = (code) => Object.freeze({
  namespace: 'linux-cd',
  code,
  evidence_sha256: sha256(canonicalJson({ namespace: 'linux-cd', code })),
})

const terminalFallback = (request, states, reasonCode, outcome = {}, failureCode = 'provisioning-required') => ({
  schema_version: 'linux-continuous-deployment-attestation/v1',
  repository: typeof request?.repository === 'string' ? request.repository : EXPECTED_REPOSITORY,
  pull_request: Number.isSafeInteger(request?.trusted_merge?.pull_request)
    ? request.trusted_merge.pull_request
    : null,
  source_head_sha: SHA1.test(request?.trusted_merge?.source_head_sha ?? '')
    ? request.trusted_merge.source_head_sha
    : null,
  trusted_merge_sha: SHA1.test(request?.trusted_merge?.trusted_merge_sha ?? '')
    ? request.trusted_merge.trusted_merge_sha
    : null,
  artifact_sha256: SHA256.test(request?.artifact?.artifact_sha256 ?? '')
    ? request.artifact.artifact_sha256
    : null,
  environment: typeof request?.target?.environment === 'string' ? request.target.environment : null,
  service: typeof request?.target?.service === 'string' ? request.target.service : null,
  target_fingerprint: SHA256.test(request?.target?.expected_fingerprint ?? '')
    ? request.target.expected_fingerprint
    : null,
  deployment_method: linuxContinuousDeploymentVocabulary.deploymentMethod,
  timestamps: {
    requested_at: UTC_TIMESTAMP.test(request?.timestamps?.requested_at ?? '')
      ? request.timestamps.requested_at
      : null,
    terminal_at: null,
  },
  verification: [],
  outcome: {
    promotion: 'not_started',
    rollback: 'not_started',
    ...outcome,
  },
  release_lineage: {
    delivery_id: typeof request?.delivery_id === 'string' ? request.delivery_id : 'unknown-delivery',
    attempt_id: typeof request?.attempt?.attempt_id === 'string' ? request.attempt.attempt_id : 'attempt:unknown',
    supersedes_delivery_id: request?.attempt?.supersedes_delivery_id ?? null,
    supersedes_attempt_id: request?.attempt?.supersedes_attempt_id ?? null,
    previous_attempt_sha256: request?.attempt?.previous_attempt_sha256 ?? null,
    previous_known_good_release_id: typeof request?.previous_known_good?.release_id === 'string'
      ? request.previous_known_good.release_id
      : null,
  },
  failure_detail: [failureDetailFor(failureCode)],
  state_history_sha256: sha256(canonicalJson(states)),
  final_state: 'HELD',
  terminal_class: 'HELD',
  reason_code: reasonCode,
})

export function parseTrustedMergeEvent(raw, {
  expectedRepository = EXPECTED_REPOSITORY,
  expectedBaseRef = 'main',
} = {}) {
  exactKeys(raw, [
    'schema_version', 'repository', 'repository_id', 'event_name', 'event_id', 'pull_request', 'merged',
    'base_ref', 'base_sha', 'source_head_ref', 'source_head_sha', 'trusted_merge_sha',
    'merge_tree_sha', 'fetched_origin_main_sha', 'policy_sha256',
    'merge_authority', 'collector', 'ci_convergence', 'observed_at',
  ])
  if (raw.schema_version !== 'linux-cd-trusted-merge-event/v1') fail('invalid_value', 'unsupported trusted merge schema')
  text(raw.repository, 'repository', REPOSITORY)
  if (raw.repository !== expectedRepository) fail('trusted_merge_repository_invalid', 'repository is not trusted')
  safeInteger(raw.repository_id, 'repository_id', 1)
  if (raw.event_name !== 'pull_request.closed' || raw.merged !== true) {
    fail('trusted_merge_event_invalid', 'only a merged pull_request.closed event is trusted')
  }
  if (raw.base_ref !== expectedBaseRef) fail('trusted_merge_base_invalid', 'base ref is not trusted')
  oid(raw.base_sha, 'base_sha')
  text(raw.event_id, 'event_id')
  safeInteger(raw.pull_request, 'pull_request', 1)
  text(raw.source_head_ref, 'source_head_ref')
  oid(raw.source_head_sha, 'source_head_sha')
  oid(raw.trusted_merge_sha, 'trusted_merge_sha')
  oid(raw.merge_tree_sha, 'merge_tree_sha')
  oid(raw.fetched_origin_main_sha, 'fetched_origin_main_sha')
  digest(raw.policy_sha256, 'policy_sha256')
  if (raw.fetched_origin_main_sha !== raw.trusted_merge_sha) {
    fail('origin_main_drift', 'fresh origin/main does not equal the trusted merge commit')
  }
  timestamp(raw.observed_at, 'observed_at')

  exactKeys(raw.merge_authority, ['kind', 'actor_id', 'evidence_sha256'])
  if (raw.merge_authority.kind !== 'github_server_trusted_merge') {
    fail('trusted_merge_authority_invalid', 'merge authority is not GitHub server state')
  }
  text(raw.merge_authority.actor_id, 'merge_authority.actor_id')
  digest(raw.merge_authority.evidence_sha256, 'merge_authority.evidence_sha256')

  exactKeys(raw.collector, ['complete', 'pages_fetched', 'expected_pages', 'evidence_sha256'])
  safeInteger(raw.collector.pages_fetched, 'collector.pages_fetched', 1)
  safeInteger(raw.collector.expected_pages, 'collector.expected_pages', 1)
  digest(raw.collector.evidence_sha256, 'collector.evidence_sha256')
  if (raw.collector.complete !== true || raw.collector.pages_fetched !== raw.collector.expected_pages) {
    fail('collector_incomplete', 'authoritative collector pagination is incomplete')
  }

  exactKeys(raw.ci_convergence, ['head_sha', 'converged', 'attestation_sha256', 'required_checks'])
  oid(raw.ci_convergence.head_sha, 'ci_convergence.head_sha')
  digest(raw.ci_convergence.attestation_sha256, 'ci_convergence.attestation_sha256')
  if (raw.ci_convergence.head_sha !== raw.source_head_sha) {
    fail('stale_ci_convergence', 'CI convergence does not bind the source head')
  }
  if (raw.ci_convergence.converged !== true || !Array.isArray(raw.ci_convergence.required_checks)
    || raw.ci_convergence.required_checks.length === 0) {
    fail('ci_convergence_incomplete', 'CI convergence is incomplete')
  }
  const seenChecks = new Set()
  for (const check of raw.ci_convergence.required_checks) {
    exactKeys(check, ['name', 'conclusion', 'source_app_id'])
    text(check.name, 'required_check.name')
    if (check.conclusion !== 'success') fail('ci_convergence_incomplete', 'a required check did not pass')
    safeInteger(check.source_app_id, 'required_check.source_app_id', 1)
    if (seenChecks.has(check.name)) fail('ci_convergence_incomplete', 'required checks are duplicated')
    seenChecks.add(check.name)
  }
  assertNoSecretValues(raw)
  return cloneFrozen(raw)
}

export function parseArtifactProvenance(raw, trustedMergeRaw, {
  now = new Date(),
  verifyArtifactProvenance,
} = {}) {
  const trusted = parseTrustedMergeEvent(trustedMergeRaw)
  exactKeys(raw, [
    'schema_version', 'repository', 'merge_sha', 'source_tree_sha', 'artifact_sha256',
    'observed_sha256', 'artifact_size_bytes', 'artifact_uri', 'policy_sha256', 'build_run',
    'provenance', 'built_at',
  ])
  if (raw.schema_version !== 'linux-cd-artifact-provenance/v1') fail('invalid_value', 'unsupported artifact schema')
  if (raw.repository !== trusted.repository) fail('artifact_repository_mismatch', 'artifact repository drifted')
  oid(raw.merge_sha, 'artifact.merge_sha')
  oid(raw.source_tree_sha, 'artifact.source_tree_sha')
  digest(raw.artifact_sha256, 'artifact.artifact_sha256')
  digest(raw.observed_sha256, 'artifact.observed_sha256')
  safeInteger(raw.artifact_size_bytes, 'artifact.artifact_size_bytes', 1)
  text(raw.artifact_uri, 'artifact.artifact_uri')
  digest(raw.policy_sha256, 'artifact.policy_sha256')
  timestamp(raw.built_at, 'artifact.built_at')
  if (raw.merge_sha !== trusted.trusted_merge_sha) fail('artifact_merge_mismatch', 'artifact is not bound to trusted merge SHA')
  if (raw.source_tree_sha !== trusted.merge_tree_sha) fail('artifact_tree_mismatch', 'artifact source tree is not the trusted merge tree')
  if (raw.policy_sha256 !== trusted.policy_sha256) fail('artifact_policy_mismatch', 'artifact policy is not the trusted policy')
  if (raw.artifact_sha256 !== raw.observed_sha256) fail('artifact_digest_mismatch', 'artifact digest readback failed')
  exactKeys(raw.build_run, ['provider', 'run_id', 'run_attempt'])
  if (raw.build_run.provider !== 'github-actions') fail('artifact_provenance_invalid', 'build provider is not trusted')
  text(raw.build_run.run_id, 'artifact.build_run.run_id')
  safeInteger(raw.build_run.run_attempt, 'artifact.build_run.run_attempt', 1)
  exactKeys(raw.provenance, [
    'issuer', 'key_id', 'algorithm', 'nonce', 'issued_at', 'expires_at',
    'payload_sha256', 'signature', 'evidence_sha256',
  ])
  text(raw.provenance.issuer, 'artifact.provenance.issuer')
  text(raw.provenance.key_id, 'artifact.provenance.key_id')
  if (raw.provenance.algorithm !== 'ed25519') fail('artifact_provenance_invalid', 'artifact provenance algorithm is not allowed')
  text(raw.provenance.nonce, 'artifact.provenance.nonce')
  timestamp(raw.provenance.issued_at, 'artifact.provenance.issued_at')
  timestamp(raw.provenance.expires_at, 'artifact.provenance.expires_at')
  digest(raw.provenance.payload_sha256, 'artifact.provenance.payload_sha256')
  text(raw.provenance.signature, 'artifact.provenance.signature')
  digest(raw.provenance.evidence_sha256, 'artifact.provenance.evidence_sha256')
  if (Date.parse(raw.provenance.issued_at) > now.getTime()
    || Date.parse(raw.provenance.expires_at) <= now.getTime()) {
    fail('artifact_provenance_invalid', 'artifact provenance is outside its validity window')
  }
  const payload = {
    repository: raw.repository,
    merge_sha: raw.merge_sha,
    source_tree_sha: raw.source_tree_sha,
    artifact_sha256: raw.artifact_sha256,
    artifact_size_bytes: raw.artifact_size_bytes,
    policy_sha256: raw.policy_sha256,
    builder: raw.build_run,
  }
  if (raw.provenance.payload_sha256 !== sha256(canonicalJson(payload))) {
    fail('artifact_provenance_invalid', 'artifact provenance payload digest drifted')
  }
  if (typeof verifyArtifactProvenance !== 'function'
    || verifyArtifactProvenance(cloneFrozen({ payload, provenance: raw.provenance })) !== true) {
    fail('external_authority_unavailable', 'artifact provenance authority was not externally verified')
  }
  assertNoSecretValues(raw)
  return cloneFrozen(raw)
}

export function parseDeploymentTarget(raw, {
  now = new Date(),
  verifyTargetLease,
} = {}) {
  assertNoTargetTopology(raw)
  exactKeys(raw, [
    'schema_version', 'source', 'target_id', 'role', 'kind', 'environment', 'service',
    'expected_fingerprint', 'observed_fingerprint', 'profile_sha256', 'deployment_method',
    'credential_authority',
  ])
  if (raw.schema_version !== 'linux-cd-deployment-target/v1') fail('invalid_value', 'unsupported target schema')
  if (raw.source !== 'server_authoritative_inventory') {
    fail('target_authority_invalid', 'target source is not authoritative')
  }
  text(raw.target_id, 'target.target_id')
  if (raw.target_id !== EXPECTED_TARGET_ID) fail('target_profile_invalid', 'target ID is not canonical-linux')
  if (raw.role !== 'canonical_test_deploy' || raw.kind !== 'linux_host_native') {
    fail('target_profile_invalid', 'target is not the canonical Linux profile')
  }
  text(raw.environment, 'target.environment')
  text(raw.service, 'target.service')
  digest(raw.expected_fingerprint, 'target.expected_fingerprint')
  digest(raw.observed_fingerprint, 'target.observed_fingerprint')
  digest(raw.profile_sha256, 'target.profile_sha256')
  if (raw.expected_fingerprint !== raw.observed_fingerprint) {
    fail('target_fingerprint_drift', 'target fingerprint drifted')
  }
  if (raw.deployment_method !== linuxContinuousDeploymentVocabulary.deploymentMethod) {
    fail('deployment_method_invalid', 'deployment method bypasses the repo golden path')
  }
  if (!isObject(raw.credential_authority)) {
    fail('credential_authority_unavailable', 'opaque credential authority is missing')
  }
  exactKeys(raw.credential_authority, [
    'kind', 'issuer', 'key_id', 'algorithm', 'lease_id', 'nonce', 'issued_at',
    'expires_at', 'payload_sha256', 'signature',
  ])
  if (raw.credential_authority.kind !== 'opaque_target_lease') {
    fail('credential_authority_unavailable', 'credential authority is not an opaque target lease')
  }
  text(raw.credential_authority.issuer, 'target.credential_authority.issuer')
  text(raw.credential_authority.key_id, 'target.credential_authority.key_id')
  if (raw.credential_authority.algorithm !== 'ed25519') {
    fail('credential_authority_unavailable', 'target lease algorithm is not allowed')
  }
  text(raw.credential_authority.lease_id, 'target.credential_authority.lease_id')
  text(raw.credential_authority.nonce, 'target.credential_authority.nonce')
  timestamp(raw.credential_authority.issued_at, 'target.credential_authority.issued_at')
  timestamp(raw.credential_authority.expires_at, 'target.credential_authority.expires_at')
  digest(raw.credential_authority.payload_sha256, 'target.credential_authority.payload_sha256')
  text(raw.credential_authority.signature, 'target.credential_authority.signature')
  if (Date.parse(raw.credential_authority.expires_at) <= now.getTime()) {
    fail('credential_authority_unavailable', 'credential authority expired')
  }
  if (Date.parse(raw.credential_authority.issued_at) > now.getTime()) {
    fail('credential_authority_unavailable', 'credential authority is not active yet')
  }
  const targetPayload = {
    target_id: raw.target_id,
    role: raw.role,
    kind: raw.kind,
    environment: raw.environment,
    service: raw.service,
    expected_fingerprint: raw.expected_fingerprint,
    profile_sha256: raw.profile_sha256,
    deployment_method: raw.deployment_method,
    lease_id: raw.credential_authority.lease_id,
  }
  if (raw.credential_authority.payload_sha256 !== sha256(canonicalJson(targetPayload))) {
    fail('credential_authority_unavailable', 'target lease payload digest drifted')
  }
  if (typeof verifyTargetLease !== 'function'
    || verifyTargetLease(cloneFrozen({ payload: targetPayload, authority: raw.credential_authority })) !== true) {
    fail('external_authority_unavailable', 'target lease authority was not externally verified')
  }
  assertNoSecretValues(raw)
  return cloneFrozen(raw)
}

const activeControllerState = (state) => !['ACTIVATED', 'ROLLED_BACK', 'HELD', 'TERMINAL_DELIVERY_ATTESTATION'].includes(state)

export function acquireSingleFlight(historyRaw, requestRaw) {
  if (!Array.isArray(historyRaw)) fail('invalid_shape', 'controller ledger must be an array')
  if (!isObject(requestRaw?.target) || !isObject(requestRaw?.controller)) fail('invalid_shape', 'request controller scope is incomplete')
  text(requestRaw.delivery_id, 'delivery_id')
  text(requestRaw.replay_key, 'replay_key')
  text(requestRaw.target.environment, 'target.environment')
  text(requestRaw.target.service, 'target.service')
  digest(requestRaw.target.expected_fingerprint, 'target.expected_fingerprint')
  if (requestRaw.target.deployment_method !== linuxContinuousDeploymentVocabulary.deploymentMethod) {
    fail('invalid_value', 'target.deployment_method is invalid')
  }
  if (!isObject(requestRaw.artifact)) fail('artifact_provenance_unavailable', 'immutable artifact is missing')
  digest(requestRaw.artifact.artifact_sha256, 'artifact.artifact_sha256')
  for (const entry of historyRaw) {
    exactKeys(entry, [
      'schema_version', 'environment', 'service', 'delivery_id', 'replay_key',
      'artifact_sha256', 'target_fingerprint', 'deployment_method', 'owner_id', 'lease_id', 'state',
    ])
    if (entry.schema_version !== 'linux-cd-controller-lease/v1') fail('invalid_value', 'controller lease schema is invalid')
    text(entry.environment, 'controller_ledger.environment')
    text(entry.service, 'controller_ledger.service')
    text(entry.delivery_id, 'controller_ledger.delivery_id')
    text(entry.replay_key, 'controller_ledger.replay_key')
    digest(entry.artifact_sha256, 'controller_ledger.artifact_sha256')
    digest(entry.target_fingerprint, 'controller_ledger.target_fingerprint')
    if (entry.deployment_method !== linuxContinuousDeploymentVocabulary.deploymentMethod) {
      fail('invalid_value', 'controller ledger deployment method is invalid')
    }
    text(entry.owner_id, 'controller_ledger.owner_id')
    text(entry.lease_id, 'controller_ledger.lease_id')
    if (!STATES.includes(entry.state)) fail('invalid_value', 'controller lease state is unknown')
  }
  const scope = `${requestRaw.target.environment}\0${requestRaw.target.service}`
  const sameReplay = historyRaw.find((entry) => entry.replay_key === requestRaw.replay_key)
  if (sameReplay) {
    if (sameReplay.delivery_id === requestRaw.delivery_id
      && sameReplay.artifact_sha256 === requestRaw.artifact.artifact_sha256
      && sameReplay.environment === requestRaw.target.environment
      && sameReplay.service === requestRaw.target.service
      && sameReplay.target_fingerprint === requestRaw.target.expected_fingerprint
      && sameReplay.deployment_method === requestRaw.target.deployment_method
      && activeControllerState(sameReplay.state)) {
      return { idempotent: true, entry: cloneFrozen(sameReplay) }
    }
    fail('replay_detected', 'trusted merge replay key was already consumed')
  }
  const conflict = historyRaw.find((entry) => `${entry.environment}\0${entry.service}` === scope
    && activeControllerState(entry.state))
  if (conflict) fail('duplicate_controller', 'environment and service already have an active controller')
  exactKeys(requestRaw.controller, ['owner_id', 'lease_id'])
  text(requestRaw.controller.owner_id, 'controller.owner_id')
  text(requestRaw.controller.lease_id, 'controller.lease_id')
  const entry = {
    schema_version: 'linux-cd-controller-lease/v1',
    environment: requestRaw.target.environment,
    service: requestRaw.target.service,
    delivery_id: requestRaw.delivery_id,
    replay_key: requestRaw.replay_key,
    artifact_sha256: requestRaw.artifact.artifact_sha256,
    target_fingerprint: requestRaw.target.expected_fingerprint,
    deployment_method: requestRaw.target.deployment_method,
    owner_id: requestRaw.controller.owner_id,
    lease_id: requestRaw.controller.lease_id,
    state: 'TRUSTED_MERGED',
  }
  return { idempotent: false, entry: cloneFrozen(entry) }
}

export function evaluateRetry(historyRaw, candidateRaw) {
  if (!Array.isArray(historyRaw)) fail('invalid_shape', 'retry history must be an array')
  for (const entry of historyRaw) {
    exactKeys(entry, [
      'failure_class', 'evidence_sha256', 'event_id', 'authorization_id', 'classification_sha256', 'ordinal',
    ])
    text(entry.failure_class, 'retry_history.failure_class')
    if (!ALLOWED_RETRY_CLASSES.includes(entry.failure_class)) {
      fail('retry_classification_invalid', 'retry history contains an unapproved failure class')
    }
    digest(entry.evidence_sha256, 'retry_history.evidence_sha256')
    text(entry.event_id, 'retry_history.event_id')
    text(entry.authorization_id, 'retry_history.authorization_id')
    digest(entry.classification_sha256, 'retry_history.classification_sha256')
    safeInteger(entry.ordinal, 'retry_history.ordinal', 1)
  }
  exactKeys(candidateRaw, [
    'failure_class', 'evidence_sha256', 'event_id', 'authorization_id', 'classification_sha256',
  ])
  text(candidateRaw.failure_class, 'retry.failure_class')
  digest(candidateRaw.evidence_sha256, 'retry.evidence_sha256')
  text(candidateRaw.event_id, 'retry.event_id')
  text(candidateRaw.authorization_id, 'retry.authorization_id')
  digest(candidateRaw.classification_sha256, 'retry.classification_sha256')
  if (historyRaw.length >= 1) fail('retry_budget_exhausted', 'exact-commit retry budget is exhausted')
  if (!ALLOWED_RETRY_CLASSES.includes(candidateRaw.failure_class)) {
    fail('retry_classification_invalid', 'failure class is not approved for same-commit retry')
  }
  if (historyRaw.some((entry) => entry.event_id === candidateRaw.event_id)) fail('replay_detected', 'retry event was replayed')
  return { allowed: true, record: cloneFrozen({ ...candidateRaw, ordinal: 1 }) }
}

const parseRetryClassification = (raw, requestRaw, trusted, artifactRaw, targetRaw, {
  now,
  verifyRetryClassification,
}) => {
  exactKeys(raw, ['failure_class', 'evidence_sha256', 'event_id', 'classification_authority'])
  text(raw.failure_class, 'retry.failure_class')
  digest(raw.evidence_sha256, 'retry.evidence_sha256')
  text(raw.event_id, 'retry.event_id')
  exactKeys(raw.classification_authority, [
    'kind', 'issuer', 'key_id', 'algorithm', 'authorization_id', 'issued_at', 'expires_at',
    'payload_sha256', 'signature',
  ])
  const authority = raw.classification_authority
  if (authority.kind !== 'owner_policy_retry_classifier' || authority.algorithm !== 'ed25519') {
    fail('retry_classification_invalid', 'retry classification authority is not allowed')
  }
  text(authority.issuer, 'retry.classification_authority.issuer')
  text(authority.key_id, 'retry.classification_authority.key_id')
  text(authority.authorization_id, 'retry.classification_authority.authorization_id')
  timestamp(authority.issued_at, 'retry.classification_authority.issued_at')
  timestamp(authority.expires_at, 'retry.classification_authority.expires_at')
  digest(authority.payload_sha256, 'retry.classification_authority.payload_sha256')
  text(authority.signature, 'retry.classification_authority.signature')
  if (Date.parse(authority.expires_at) <= now.getTime() || Date.parse(authority.issued_at) > now.getTime()) {
    fail('retry_classification_invalid', 'retry classification authority is not active')
  }
  const payload = {
    repository: requestRaw.repository,
    delivery_id: requestRaw.delivery_id,
    attempt_id: requestRaw.attempt.attempt_id,
    supersedes_delivery_id: requestRaw.attempt.supersedes_delivery_id,
    supersedes_attempt_id: requestRaw.attempt.supersedes_attempt_id,
    previous_attempt_sha256: requestRaw.attempt.previous_attempt_sha256,
    trusted_merge_sha: trusted.trusted_merge_sha,
    artifact_sha256: artifactRaw.artifact_sha256,
    target_id: targetRaw.target_id,
    target_fingerprint: targetRaw.expected_fingerprint,
    deployment_method: targetRaw.deployment_method,
    policy_sha256: trusted.policy_sha256,
    failure_class: raw.failure_class,
    evidence_sha256: raw.evidence_sha256,
    event_id: raw.event_id,
    authorization_id: authority.authorization_id,
  }
  if (authority.payload_sha256 !== sha256(canonicalJson(payload))) {
    fail('retry_classification_invalid', 'retry classification payload digest drifted')
  }
  if (typeof verifyRetryClassification !== 'function'
    || verifyRetryClassification(cloneFrozen({ payload, authority })) !== true) {
    fail('external_authority_unavailable', 'retry classification was not externally verified')
  }
  assertNoSecretValues(raw)
  return cloneFrozen({
    failure_class: raw.failure_class,
    evidence_sha256: raw.evidence_sha256,
    event_id: raw.event_id,
    authorization_id: authority.authorization_id,
    classification_sha256: sha256(canonicalJson(authority)),
  })
}

const validateRetryParent = (requestRaw, trusted, targetRaw) => {
  const attempt = requestRaw.attempt
  const parentRaw = requestRaw.terminal_history.find((entry) => (
    entry?.delivery_id === attempt.supersedes_delivery_id
    && entry?.attempt_id === attempt.supersedes_attempt_id
  ))
  if (!parentRaw) fail('retry_parent_invalid', 'retry parent terminal attempt was not found')
  const parent = parseTerminalRecord(canonicalJson(parentRaw))
  if (sha256(canonicalJson(parent)) !== attempt.previous_attempt_sha256) {
    fail('retry_parent_invalid', 'retry parent digest does not match the linked terminal attempt')
  }
  if (parent.terminal_class !== 'FAILED'
    || parent.reason_code !== 'MERGED_NOT_DELIVERED'
    || parent.delivery_id !== requestRaw.delivery_id
    || parent.supersedes_delivery_id !== null
    || parent.supersedes_attempt_id !== null
    || parent.previous_attempt_sha256 !== null
    || parent.merge_observed !== true
    || parent.command_state !== 'completed'
    || parent.merge_commit_oid !== trusted.trusted_merge_sha
    || parent.fetched_origin_main_oid !== trusted.trusted_merge_sha
    || parent.target_id !== targetRaw.target_id) {
    fail('retry_parent_invalid', 'retry parent is not a failed transient delivery of the exact merge and target')
  }
  return parent
}

const consumeRetryBudget = (requestRaw, trusted, parent, retryRecord, consumeRetryBudgetCallback) => {
  const payload = {
    authorization_id: retryRecord.authorization_id,
    delivery_id: parent.delivery_id,
    trusted_merge_sha: trusted.trusted_merge_sha,
    root_attempt_sha256: sha256(canonicalJson(parent)),
    failure_event_id: retryRecord.event_id,
    classification_sha256: retryRecord.classification_sha256,
  }
  if (typeof consumeRetryBudgetCallback !== 'function') {
    fail('external_authority_unavailable', 'authoritative retry budget broker is unavailable')
  }
  const receipt = consumeRetryBudgetCallback(cloneFrozen({ payload }))
  exactKeys(receipt, [
    'authorization_id', 'authoritative_prior_retry_count', 'consumed',
  ], 'external_authority_unavailable')
  if (receipt.authorization_id !== retryRecord.authorization_id) {
    fail('external_authority_unavailable', 'retry budget receipt authorization drifted')
  }
  safeInteger(receipt.authoritative_prior_retry_count, 'retry_budget.authoritative_prior_retry_count')
  if (receipt.authoritative_prior_retry_count !== 0 || receipt.consumed !== true) {
    fail('retry_budget_exhausted', 'authoritative exact-commit retry budget is exhausted')
  }
  return cloneFrozen(receipt)
}

export function appendDeliveryLedger(historyRaw, candidateRaw) {
  if (!Array.isArray(historyRaw)) fail('invalid_shape', 'delivery ledger must be an array')
  if (isObject(candidateRaw) && historyRaw.some((entry) => entry.event_id === candidateRaw.event_id)) {
    fail('ledger_rewrite_forbidden', 'delivery ledger event already exists')
  }
  exactKeys(candidateRaw, ['delivery_id', 'event_id', 'state', 'evidence_sha256', 'previous_sha256'])
  text(candidateRaw.delivery_id, 'ledger.delivery_id')
  text(candidateRaw.event_id, 'ledger.event_id')
  if (!STATES.includes(candidateRaw.state)) fail('invalid_value', 'ledger state is unknown')
  digest(candidateRaw.evidence_sha256, 'ledger.evidence_sha256')
  const previous = historyRaw.at(-1) ?? null
  if (previous === null && candidateRaw.previous_sha256 !== null) fail('ledger_lineage_invalid', 'root ledger event has a parent')
  if (previous !== null && candidateRaw.previous_sha256 !== previous.record_sha256) {
    fail('ledger_lineage_invalid', 'ledger event does not extend the current tail')
  }
  if (previous !== null && previous.delivery_id !== candidateRaw.delivery_id) {
    fail('ledger_lineage_invalid', 'delivery ledger changed delivery identity')
  }
  const record = { ...candidateRaw }
  return cloneFrozen({ ...record, record_sha256: sha256(canonicalJson(record)) })
}

const parseVerification = (raw, expectedDigest) => {
  exactKeys(raw, ['observation_started_at', 'observation_ended_at', 'artifact_sha256', 'gates'])
  timestamp(raw.observation_started_at, 'verification.observation_started_at')
  timestamp(raw.observation_ended_at, 'verification.observation_ended_at')
  if (Date.parse(raw.observation_ended_at) <= Date.parse(raw.observation_started_at)) {
    fail('verification_window_invalid', 'verification observation window is empty')
  }
  digest(raw.artifact_sha256, 'verification.artifact_sha256')
  if (raw.artifact_sha256 !== expectedDigest) fail('verification_digest_mismatch', 'verification used another artifact')
  if (!Array.isArray(raw.gates)) fail('invalid_shape', 'verification gates must be an array')
  const ids = []
  for (const gate of raw.gates) {
    exactKeys(gate, ['id', 'status', 'evidence_sha256'])
    if (!REQUIRED_VERIFICATION_GATES.includes(gate.id)) fail('verification_gate_invalid', 'unknown verification gate')
    if (!['passed', 'failed', 'held'].includes(gate.status)) fail('verification_gate_invalid', 'unknown verification status')
    digest(gate.evidence_sha256, 'verification.gate.evidence_sha256')
    if (ids.includes(gate.id)) fail('verification_gate_invalid', 'verification gate is duplicated')
    ids.push(gate.id)
  }
  if (canonicalJson([...ids].sort()) !== canonicalJson([...REQUIRED_VERIFICATION_GATES].sort())) {
    fail('verification_incomplete', 'health, smoke and e2e evidence are all required')
  }
  return { parsed: cloneFrozen(raw), passed: raw.gates.every((gate) => gate.status === 'passed') }
}

const buildVerificationSummary = (stage, raw) => raw.gates.map((gate) => ({
  stage,
  gate_id: gate.id,
  status: gate.status,
  evidence_sha256: gate.evidence_sha256,
}))

const validateKnownGood = (raw, targetRaw, {
  expectedPolicySha256,
  verifyKnownGoodProvenance,
} = {}) => {
  if (!isObject(raw)) fail('known_good_unavailable', 'pinned known-good artifact is missing')
  exactKeys(raw, [
    'artifact_sha256', 'provenance_sha256', 'release_id', 'source_merge_sha',
    'source_tree_sha', 'policy_sha256', 'issuer', 'key_id', 'target_fingerprint',
  ])
  digest(raw.artifact_sha256, 'known_good.artifact_sha256')
  digest(raw.provenance_sha256, 'known_good.provenance_sha256')
  text(raw.release_id, 'known_good.release_id')
  oid(raw.source_merge_sha, 'known_good.source_merge_sha')
  oid(raw.source_tree_sha, 'known_good.source_tree_sha')
  digest(raw.policy_sha256, 'known_good.policy_sha256')
  text(raw.issuer, 'known_good.issuer')
  text(raw.key_id, 'known_good.key_id')
  digest(raw.target_fingerprint, 'known_good.target_fingerprint')
  if (raw.target_fingerprint !== targetRaw.expected_fingerprint) {
    fail('known_good_target_mismatch', 'known-good artifact belongs to another target')
  }
  if (raw.policy_sha256 !== expectedPolicySha256) {
    fail('known_good_unavailable', 'known-good artifact policy drifted')
  }
  if (typeof verifyKnownGoodProvenance !== 'function'
    || verifyKnownGoodProvenance(cloneFrozen(raw)) !== true) {
    fail('external_authority_unavailable', 'known-good provenance authority was not externally verified')
  }
  return cloneFrozen(raw)
}

const rollbackResult = (requestRaw, states, verificationSummary, transition, trustBoundary) => {
  try {
    const knownGood = validateKnownGood(requestRaw.previous_known_good, requestRaw.target, {
      expectedPolicySha256: requestRaw.trusted_merge.policy_sha256,
      verifyKnownGoodProvenance: trustBoundary?.verifyKnownGoodProvenance,
    })
    transition('ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT')
    if (!isObject(requestRaw.rollback) || requestRaw.rollback.attempted !== true
      || requestRaw.rollback.artifact_sha256 !== knownGood.artifact_sha256
      || !isObject(requestRaw.rollback.verification)) {
      fail('rollback_unavailable', 'pinned known-good rollback was not executed')
    }
    transition('VERIFY_ROLLBACK')
    const rollback = parseVerification(requestRaw.rollback.verification, knownGood.artifact_sha256)
    verificationSummary.push(...buildVerificationSummary('rollback', rollback.parsed))
    if (!rollback.passed) fail('rollback_unverified', 'rollback verification did not pass')
    transition('ROLLED_BACK')
    return {
      finalState: 'ROLLED_BACK',
      reasonCode: 'MERGED_NOT_DELIVERED',
      promotion: 'failed',
      rollback: 'verified',
    }
  } catch (error) {
    transition('HELD')
    return {
      finalState: 'HELD',
      reasonCode: terminalReasonForError(error, states),
      promotion: 'failed',
      rollback: 'unverified',
    }
  }
}

const buildAttestation = (requestRaw, states, finalState, reasonCode, verificationSummary, {
  promotion,
  rollback,
  terminalAt,
}) => ({
  schema_version: 'linux-continuous-deployment-attestation/v1',
  repository: requestRaw.repository,
  pull_request: requestRaw.trusted_merge.pull_request,
  source_head_sha: requestRaw.trusted_merge.source_head_sha,
  trusted_merge_sha: requestRaw.trusted_merge.trusted_merge_sha,
  artifact_sha256: requestRaw.artifact?.artifact_sha256 ?? null,
  environment: requestRaw.target?.environment ?? null,
  service: requestRaw.target?.service ?? null,
  target_fingerprint: requestRaw.target?.expected_fingerprint ?? null,
  deployment_method: linuxContinuousDeploymentVocabulary.deploymentMethod,
  timestamps: {
    requested_at: requestRaw.timestamps.requested_at,
    terminal_at: terminalAt,
  },
  verification: verificationSummary,
  outcome: { promotion, rollback },
  release_lineage: {
    delivery_id: requestRaw.delivery_id,
    attempt_id: requestRaw.attempt.attempt_id,
    supersedes_delivery_id: requestRaw.attempt.supersedes_delivery_id,
    supersedes_attempt_id: requestRaw.attempt.supersedes_attempt_id,
    previous_attempt_sha256: requestRaw.attempt.previous_attempt_sha256,
    previous_known_good_release_id: requestRaw.previous_known_good?.release_id ?? null,
  },
  failure_detail: reasonCode === 'DELIVERY_VERIFIED' ? [] : [failureDetailFor(reasonCode.toLowerCase())],
  state_history_sha256: sha256(canonicalJson(states)),
  final_state: finalState,
  terminal_class: terminalClassForState(finalState),
  reason_code: reasonCode,
})

export function parseTerminalDeliveryAttestation(raw) {
  exactKeys(raw, [
    'schema_version', 'repository', 'pull_request', 'source_head_sha', 'trusted_merge_sha',
    'artifact_sha256', 'environment', 'service', 'target_fingerprint', 'deployment_method',
    'timestamps', 'verification', 'outcome', 'release_lineage', 'state_history_sha256',
    'failure_detail', 'final_state', 'terminal_class', 'reason_code',
  ])
  if (raw.schema_version !== 'linux-continuous-deployment-attestation/v1') fail('invalid_value', 'unsupported attestation schema')
  text(raw.repository, 'attestation.repository', REPOSITORY)
  if (raw.pull_request !== null) safeInteger(raw.pull_request, 'attestation.pull_request', 1)
  for (const [name, value] of [
    ['source_head_sha', raw.source_head_sha],
    ['trusted_merge_sha', raw.trusted_merge_sha],
  ]) if (value !== null) oid(value, `attestation.${name}`)
  for (const [name, value] of [
    ['artifact_sha256', raw.artifact_sha256],
    ['target_fingerprint', raw.target_fingerprint],
  ]) if (value !== null) digest(value, `attestation.${name}`)
  if (raw.environment !== null) text(raw.environment, 'attestation.environment')
  if (raw.service !== null) text(raw.service, 'attestation.service')
  if (raw.deployment_method !== linuxContinuousDeploymentVocabulary.deploymentMethod) {
    fail('deployment_method_invalid', 'attestation deployment method drifted')
  }
  exactKeys(raw.timestamps, ['requested_at', 'terminal_at'])
  if (raw.timestamps.requested_at !== null) timestamp(raw.timestamps.requested_at, 'attestation.requested_at')
  if (raw.timestamps.terminal_at !== null) timestamp(raw.timestamps.terminal_at, 'attestation.terminal_at')
  if (!Array.isArray(raw.verification)) fail('invalid_shape', 'attestation verification must be an array')
  for (const item of raw.verification) {
    exactKeys(item, ['stage', 'gate_id', 'status', 'evidence_sha256'])
    if (!['canary', 'post_deploy', 'rollback'].includes(item.stage)) fail('invalid_value', 'attestation verification stage is invalid')
    if (!REQUIRED_VERIFICATION_GATES.includes(item.gate_id)) fail('invalid_value', 'attestation gate is invalid')
    if (!['passed', 'failed', 'held'].includes(item.status)) fail('invalid_value', 'attestation gate status is invalid')
    digest(item.evidence_sha256, 'attestation.verification.evidence_sha256')
  }
  exactKeys(raw.outcome, ['promotion', 'rollback'])
  if (!['verified', 'failed', 'not_started'].includes(raw.outcome.promotion)) fail('invalid_value', 'promotion outcome is invalid')
  if (!['verified', 'unverified', 'not_started'].includes(raw.outcome.rollback)) fail('invalid_value', 'rollback outcome is invalid')
  exactKeys(raw.release_lineage, [
    'delivery_id', 'attempt_id', 'supersedes_delivery_id', 'supersedes_attempt_id',
    'previous_attempt_sha256', 'previous_known_good_release_id',
  ])
  text(raw.release_lineage.delivery_id, 'attestation.release_lineage.delivery_id')
  text(raw.release_lineage.attempt_id, 'attestation.release_lineage.attempt_id')
  const supersedes = [
    raw.release_lineage.supersedes_delivery_id,
    raw.release_lineage.supersedes_attempt_id,
    raw.release_lineage.previous_attempt_sha256,
  ]
  if (!supersedes.every((value) => value === null) && !supersedes.every((value) => value !== null)) {
    fail('terminal_attestation_incomplete', 'attestation supersedes lineage is partial')
  }
  if (raw.release_lineage.supersedes_delivery_id !== null) {
    text(raw.release_lineage.supersedes_delivery_id, 'attestation.supersedes_delivery_id')
    text(raw.release_lineage.supersedes_attempt_id, 'attestation.supersedes_attempt_id')
    digest(raw.release_lineage.previous_attempt_sha256, 'attestation.previous_attempt_sha256')
  }
  if (raw.release_lineage.previous_known_good_release_id !== null) {
    text(raw.release_lineage.previous_known_good_release_id, 'attestation.previous_known_good_release_id')
  }
  digest(raw.state_history_sha256, 'attestation.state_history_sha256')
  if (!Array.isArray(raw.failure_detail)) fail('invalid_shape', 'attestation failure detail must be an array')
  for (const detail of raw.failure_detail) {
    exactKeys(detail, ['namespace', 'code', 'evidence_sha256'])
    text(detail.namespace, 'attestation.failure_detail.namespace')
    text(detail.code, 'attestation.failure_detail.code')
    digest(detail.evidence_sha256, 'attestation.failure_detail.evidence_sha256')
  }
  if (!FINAL_STATES.includes(raw.final_state)) fail('invalid_value', 'attestation final state is invalid')
  if (!TERMINAL_CLASSES.includes(raw.terminal_class)
    || raw.terminal_class !== terminalClassForState(raw.final_state)) {
    fail('terminal_attestation_incomplete', 'terminal class does not match final state')
  }
  if (!REASON_CODES.includes(raw.reason_code)) fail('invalid_value', 'attestation reason code is invalid')
  if (raw.final_state === 'ACTIVATED') {
    if ([raw.pull_request, raw.source_head_sha, raw.trusted_merge_sha, raw.artifact_sha256,
      raw.environment, raw.service, raw.target_fingerprint, raw.timestamps.terminal_at].some((item) => item === null)) {
      fail('terminal_attestation_incomplete', 'activated attestation is incomplete')
    }
    if (raw.outcome.promotion !== 'verified' || raw.outcome.rollback !== 'not_started') {
      fail('terminal_attestation_incomplete', 'activated outcome is inconsistent')
    }
    if (raw.reason_code !== 'DELIVERY_VERIFIED') {
      fail('terminal_attestation_incomplete', 'activated reason code is inconsistent')
    }
  }
  if (raw.final_state === 'ROLLED_BACK' && raw.reason_code !== 'MERGED_NOT_DELIVERED') {
    fail('terminal_attestation_incomplete', 'rolled-back reason code is inconsistent')
  }
  assertNoSecretValues(raw)
  return cloneFrozen(raw)
}

const outerArtifact = (artifactId, artifactSha256, sizeBytes = 1) => ({
  artifact_id: artifactId,
  sha256: artifactSha256,
  size_bytes: sizeBytes,
  media_type: 'application/json',
  retention_class: 'delivery_30d',
})

export function buildOuterTerminalRecord(requestRaw, attestationRaw, statesRaw) {
  const attestation = parseTerminalDeliveryAttestation(attestationRaw)
  if (!Array.isArray(statesRaw) || statesRaw.some((state) => !STATES.includes(state))) {
    fail('invalid_shape', 'outer terminal state history is invalid')
  }
  const trusted = requestRaw.trusted_merge
  const mergeObserved = statesRaw.includes('TRUSTED_MERGED')
    && trusted?.repository === EXPECTED_REPOSITORY
    && Number.isSafeInteger(trusted?.repository_id)
    && SHA1.test(trusted?.trusted_merge_sha ?? '')
    && SHA1.test(trusted?.fetched_origin_main_sha ?? '')
    && trusted.fetched_origin_main_sha === trusted.trusted_merge_sha
  const afterCommand = statesRaw.some((state) => [
    'DEPLOY_CANARY', 'VERIFY_HEALTH_SMOKE_E2E', 'PROMOTE', 'POST_DEPLOY_VERIFY',
    'ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT', 'VERIFY_ROLLBACK', 'ROLLED_BACK', 'ACTIVATED',
  ].includes(state))
  let reasonCode = attestation.reason_code
  if (!mergeObserved && !['PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE'].includes(reasonCode)) {
    reasonCode = 'PREMERGE_EVIDENCE_INVALID'
  }
  if (afterCommand && reasonCode === 'DEPLOYMENT_BLOCKED') reasonCode = 'ACTIVATION_UNATTESTED'
  const terminalClass = attestation.final_state === 'ACTIVATED'
    ? 'DELIVERED'
    : attestation.final_state === 'ROLLED_BACK' ? 'FAILED' : 'HELD'
  const gates = [...attestation.verification].map((gate) => ({
    gate_id: `${gate.stage}-${gate.gate_id}`,
    status: gate.status,
    result_sha256: gate.evidence_sha256,
  })).sort((left, right) => left.gate_id.localeCompare(right.gate_id))
  const artifacts = []
  if (SHA256.test(attestation.artifact_sha256 ?? '')) {
    artifacts.push(outerArtifact('linux-cd:immutable-artifact', attestation.artifact_sha256,
      requestRaw.artifact?.artifact_size_bytes ?? 1))
  }
  for (const detail of attestation.failure_detail) {
    artifacts.push(outerArtifact(`linux-cd-failure:${detail.code}`, detail.evidence_sha256))
  }
  artifacts.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
  const failureDetail = attestation.failure_detail.map((detail) => ({ ...detail }))
    .sort((left, right) => `${left.namespace}\0${left.code}`.localeCompare(`${right.namespace}\0${right.code}`))
  if (terminalClass === 'FAILED' && !gates.some((gate) => gate.status === 'failed')) {
    gates.push({
      gate_id: 'linux-cd-terminal-failure',
      status: 'failed',
      result_sha256: failureDetail[0].evidence_sha256,
    })
    gates.sort((left, right) => left.gate_id.localeCompare(right.gate_id))
  }
  const attempt = requestRaw.attempt ?? {}
  const runnerIds = Array.isArray(requestRaw.runner_ids)
    ? [...new Set(requestRaw.runner_ids)].sort()
    : []
  const record = {
    schema_version: 'autonomous-delivery-terminal-record/v1',
    delivery_id: attestation.release_lineage.delivery_id,
    attempt_id: attestation.release_lineage.attempt_id,
    pr_class: attempt.pr_class ?? 'ordinary',
    supersedes_delivery_id: attestation.release_lineage.supersedes_delivery_id,
    supersedes_attempt_id: attestation.release_lineage.supersedes_attempt_id,
    previous_attempt_sha256: attestation.release_lineage.previous_attempt_sha256,
    repository: {
      full_name: EXPECTED_REPOSITORY,
      repository_id: mergeObserved ? trusted.repository_id : (requestRaw.repository_id ?? 1),
    },
    pull_request: {
      number: Number.isSafeInteger(trusted?.pull_request) ? trusted.pull_request : 1,
      base_oid: SHA1.test(trusted?.base_sha ?? '') ? trusted.base_sha : '0'.repeat(40),
      head_oid: SHA1.test(trusted?.source_head_sha ?? '') ? trusted.source_head_sha : '0'.repeat(40),
    },
    phase: 'CLOSED',
    last_phase: mergeObserved ? (afterCommand ? 'VERIFYING_DEPLOYMENT' : 'MERGED') : 'VERIFYING',
    terminal_class: terminalClass,
    reason_code: reasonCode,
    merge_observed: mergeObserved,
    merge_commit_oid: mergeObserved ? trusted.trusted_merge_sha : null,
    fetched_origin_main_oid: mergeObserved ? trusted.fetched_origin_main_sha : null,
    deployed_commit_oid: terminalClass === 'DELIVERED' ? trusted.trusted_merge_sha : null,
    command_state: afterCommand ? 'completed' : 'not_started',
    target_id: afterCommand && requestRaw.target?.target_id === EXPECTED_TARGET_ID
      ? EXPECTED_TARGET_ID
      : null,
    runner_ids: afterCommand ? runnerIds : [],
    gates,
    artifacts,
    failure_detail: failureDetail,
    closed_at: attestation.timestamps.terminal_at,
  }
  const parsed = parseTerminalRecord(canonicalJson(record))
  validateAttemptAppend(requestRaw.terminal_history ?? [], parsed)
  return parsed
}

export function runLinuxContinuousDeployment(requestRaw, {
  now = new Date(),
  trustBoundary = {},
} = {}) {
  const states = []
  const verificationSummary = []
  const ledgerAppends = []
  let transitionHistory = Array.isArray(requestRaw?.transition_ledger)
    ? [...requestRaw.transition_ledger]
    : []
  let trusted
  let artifactRaw
  let targetRaw
  let controllerLease = null
  let retryRecord = null

  const transition = (state) => {
    const eventId = `${requestRaw.delivery_id}:${requestRaw.attempt.attempt_id}:${transitionHistory.length + 1}:${state}`
    const record = appendDeliveryLedger(transitionHistory, {
      delivery_id: requestRaw.delivery_id,
      event_id: eventId,
      state,
      evidence_sha256: sha256(canonicalJson({ event_id: eventId, state })),
      previous_sha256: transitionHistory.at(-1)?.record_sha256 ?? null,
    })
    transitionHistory.push(record)
    ledgerAppends.push(record)
    states.push(state)
  }

  const close = (finalState, attestationRaw) => {
    const attestation = parseTerminalDeliveryAttestation(attestationRaw)
    const terminalRecord = buildOuterTerminalRecord(requestRaw, attestation, states)
    return {
      final_state: finalState,
      states: cloneFrozen(states),
      attestation,
      terminal_record: terminalRecord,
      controller_lease: controllerLease,
      retry_record: retryRecord,
      ledger_appends: cloneFrozen(ledgerAppends),
      ...(targetRaw ? { target: targetRaw } : {}),
    }
  }

  try {
    exactKeys(requestRaw, [
      'schema_version', 'delivery_id', 'repository', 'replay_key', 'trusted_merge', 'artifact',
      'target', 'controller', 'ledger', 'transition_ledger', 'attempt', 'terminal_history',
      'runner_ids', 'canary', 'promotion', 'post_deploy', 'previous_known_good', 'rollback',
      'retry_history', 'retry_event', 'timestamps',
    ])
    if (requestRaw.schema_version !== 'linux-continuous-deployment-request/v1') fail('invalid_value', 'unsupported delivery request schema')
    text(requestRaw.delivery_id, 'delivery_id')
    if (requestRaw.repository !== EXPECTED_REPOSITORY) fail('trusted_merge_repository_invalid', 'request repository is not trusted')
    text(requestRaw.replay_key, 'replay_key')
    exactKeys(requestRaw.attempt, [
      'attempt_id', 'pr_class', 'supersedes_delivery_id', 'supersedes_attempt_id', 'previous_attempt_sha256',
    ])
    text(requestRaw.attempt.attempt_id, 'attempt.attempt_id')
    if (!['ordinary', 'repair', 'revert', 'release_hotfix', 'activation_canary', 'activation_closure', 'reconciliation'].includes(requestRaw.attempt.pr_class)) {
      fail('invalid_value', 'attempt PR class is invalid')
    }
    const supersedes = [requestRaw.attempt.supersedes_delivery_id, requestRaw.attempt.supersedes_attempt_id,
      requestRaw.attempt.previous_attempt_sha256]
    if (!supersedes.every((value) => value === null) && !supersedes.every((value) => value !== null)) {
      fail('invalid_value', 'attempt lineage is partial')
    }
    if (requestRaw.attempt.supersedes_delivery_id !== null) {
      text(requestRaw.attempt.supersedes_delivery_id, 'attempt.supersedes_delivery_id')
      text(requestRaw.attempt.supersedes_attempt_id, 'attempt.supersedes_attempt_id')
      digest(requestRaw.attempt.previous_attempt_sha256, 'attempt.previous_attempt_sha256')
    }
    if (!Array.isArray(requestRaw.terminal_history) || !Array.isArray(requestRaw.runner_ids)
      || requestRaw.runner_ids.length > 32 || new Set(requestRaw.runner_ids).size !== requestRaw.runner_ids.length) {
      fail('invalid_shape', 'terminal history or runner IDs are invalid')
    }
    requestRaw.runner_ids.forEach((runnerId) => text(runnerId, 'runner_id'))
    exactKeys(requestRaw.timestamps, ['requested_at'])
    timestamp(requestRaw.timestamps.requested_at, 'timestamps.requested_at')
    trusted = parseTrustedMergeEvent(requestRaw.trusted_merge, { expectedRepository: EXPECTED_REPOSITORY })
    transition('TRUSTED_MERGED')
    if (!isObject(requestRaw.artifact)) {
      transition('PROVISIONING_REQUIRED')
      transition('HELD')
      transition('TERMINAL_DELIVERY_ATTESTATION')
      const attestation = terminalFallback(requestRaw, states, 'DEPLOYMENT_BLOCKED')
      attestation.timestamps.terminal_at = now.toISOString()
      return close('HELD', attestation)
    }
    transition('BUILD_IMMUTABLE_ARTIFACT')
    artifactRaw = parseArtifactProvenance(requestRaw.artifact, trusted, {
      now,
      verifyArtifactProvenance: trustBoundary.verifyArtifactProvenance,
    })
    transition('VERIFY_ARTIFACT_PROVENANCE')
    transition('RESOLVE_DEPLOYMENT_TARGET')
    if (!isObject(requestRaw.target)) {
      transition('PROVISIONING_REQUIRED')
      transition('HELD')
      transition('TERMINAL_DELIVERY_ATTESTATION')
      const attestation = terminalFallback(requestRaw, states, 'DEPLOYMENT_BLOCKED')
      attestation.timestamps.terminal_at = now.toISOString()
      return close('HELD', attestation)
    }
    targetRaw = parseDeploymentTarget(requestRaw.target, {
      now,
      verifyTargetLease: trustBoundary.verifyTargetLease,
    })
    const acquisition = acquireSingleFlight(requestRaw.ledger, requestRaw)
    controllerLease = acquisition.entry
    if (acquisition.idempotent) {
      states.length = 0
      ledgerAppends.length = 0
      return cloneFrozen({
        controller_disposition: 'idempotent_active',
        final_state: null,
        active_state: acquisition.entry.state,
        states,
        attestation: null,
        terminal_record: null,
        controller_lease: acquisition.entry,
        retry_record: null,
        ledger_appends: ledgerAppends,
        target: targetRaw,
      })
    }
    if (!Array.isArray(requestRaw.retry_history)) fail('invalid_shape', 'retry history must be an array')
    if (isObject(requestRaw.retry_event)) {
      const retryCandidate = parseRetryClassification(requestRaw.retry_event, requestRaw, trusted, artifactRaw, targetRaw, {
        now,
        verifyRetryClassification: trustBoundary.verifyRetryClassification,
      })
      retryRecord = evaluateRetry(requestRaw.retry_history, retryCandidate).record
      if (requestRaw.attempt.supersedes_delivery_id === null) {
        fail('invalid_value', 'retry attempt must link its superseded terminal attempt')
      }
      const retryParent = validateRetryParent(requestRaw, trusted, targetRaw)
      consumeRetryBudget(requestRaw, trusted, retryParent, retryRecord, trustBoundary.consumeRetryBudget)
    } else if (requestRaw.retry_event !== null) {
      fail('invalid_shape', 'retry event must be an object or null')
    } else if (requestRaw.retry_history.length > 0) {
      fail('retry_budget_exhausted', 'retry event is required for a retry attempt')
    }
    transition('PRE_DEPLOY_CHECK')
    validateKnownGood(requestRaw.previous_known_good, targetRaw, {
      expectedPolicySha256: trusted.policy_sha256,
      verifyKnownGoodProvenance: trustBoundary.verifyKnownGoodProvenance,
    })
    transition('DEPLOY_CANARY')
    const canary = parseVerification(requestRaw.canary, artifactRaw.artifact_sha256)
    transition('VERIFY_HEALTH_SMOKE_E2E')
    verificationSummary.push(...buildVerificationSummary('canary', canary.parsed))
    if (!canary.passed) {
      const rollback = rollbackResult(requestRaw, states, verificationSummary, transition, trustBoundary)
      transition('TERMINAL_DELIVERY_ATTESTATION')
      const attestation = buildAttestation(requestRaw, states, rollback.finalState, rollback.reasonCode,
        verificationSummary, { promotion: rollback.promotion, rollback: rollback.rollback, terminalAt: now.toISOString() })
      return close(rollback.finalState, attestation)
    }
    exactKeys(requestRaw.promotion, ['artifact_sha256', 'approved_at'])
    digest(requestRaw.promotion.artifact_sha256, 'promotion.artifact_sha256')
    timestamp(requestRaw.promotion.approved_at, 'promotion.approved_at')
    transition('PROMOTE')
    if (requestRaw.promotion.artifact_sha256 !== artifactRaw.artifact_sha256) {
      const rollback = rollbackResult(requestRaw, states, verificationSummary, transition, trustBoundary)
      transition('TERMINAL_DELIVERY_ATTESTATION')
      const attestation = buildAttestation(requestRaw, states, rollback.finalState, rollback.reasonCode,
        verificationSummary, { promotion: rollback.promotion, rollback: rollback.rollback, terminalAt: now.toISOString() })
      return close(rollback.finalState, attestation)
    }
    transition('POST_DEPLOY_VERIFY')
    const postDeploy = parseVerification(requestRaw.post_deploy, artifactRaw.artifact_sha256)
    verificationSummary.push(...buildVerificationSummary('post_deploy', postDeploy.parsed))
    if (!postDeploy.passed) {
      const rollback = rollbackResult(requestRaw, states, verificationSummary, transition, trustBoundary)
      transition('TERMINAL_DELIVERY_ATTESTATION')
      const attestation = buildAttestation(requestRaw, states, rollback.finalState, rollback.reasonCode,
        verificationSummary, { promotion: rollback.promotion, rollback: rollback.rollback, terminalAt: now.toISOString() })
      return close(rollback.finalState, attestation)
    }
    transition('ACTIVATED')
    transition('TERMINAL_DELIVERY_ATTESTATION')
    const attestation = buildAttestation(requestRaw, states, 'ACTIVATED', 'DELIVERY_VERIFIED',
      verificationSummary, { promotion: 'verified', rollback: 'not_started', terminalAt: now.toISOString() })
    return close('ACTIVATED', attestation)
  } catch (error) {
    try {
      if (!states.includes('HELD')) transition('HELD')
      if (!states.includes('TERMINAL_DELIVERY_ATTESTATION')) transition('TERMINAL_DELIVERY_ATTESTATION')
    } catch {
      if (!states.includes('HELD')) states.push('HELD')
      if (!states.includes('TERMINAL_DELIVERY_ATTESTATION')) states.push('TERMINAL_DELIVERY_ATTESTATION')
    }
    const reasonCode = terminalReasonForError(error, states)
    const failureCode = error instanceof LinuxContinuousDeploymentError ? error.code : 'unexpected-contract-failure'
    const attestation = terminalFallback(requestRaw, states, reasonCode, {}, failureCode)
    attestation.timestamps.terminal_at = now.toISOString()
    try {
      return close('HELD', attestation)
    } catch {
      return {
        final_state: 'HELD',
        states: cloneFrozen(states),
        attestation: parseTerminalDeliveryAttestation(attestation),
        terminal_record: null,
        controller_lease: controllerLease,
        retry_record: retryRecord,
        ledger_appends: cloneFrozen(ledgerAppends),
      }
    }
  }
}
