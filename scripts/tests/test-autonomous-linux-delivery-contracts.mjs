import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AutonomousDeliveryContractError,
  allowedQueueLanes,
  assertPhaseTransition,
  attestationSigningBytes,
  authorizeAttestationEnvelope,
  autonomousDeliveryVocabulary,
  canonicalJson,
  classifyPullRequest,
  parseAdjudicationPacket,
  parseAttestationEnvelope,
  parseTerminalRecord,
  sha256,
  validateAttemptAppend,
} from '../lib/autonomous-delivery-contract.mjs'


const BASE = 'b'.repeat(40)
const HEAD = 'a'.repeat(40)
const MERGE = 'c'.repeat(40)
const DIGEST = (name) => sha256(name)
const NOW = new Date('2026-08-17T08:00:00.000Z')

const expectCode = (code, callback) => {
  assert.throws(callback, (error) => (
    error instanceof AutonomousDeliveryContractError && error.code === code
  ))
}

const lineage = (overrides = {}) => ({
  remediation_kind: null,
  failure_delivery_id: null,
  reconciliation_delivery_id: null,
  debt_id: null,
  activation_plan_id: null,
  canary_delivery_id: null,
  release_id: null,
  ...overrides,
})

const classifierInput = (overrides = {}) => ({
  schema_version: 'autonomous-delivery-classifier-input/v1',
  source: 'server_authoritative',
  repository: { full_name: 'monkey1sai/AI-BIM-governance', repository_id: 123456 },
  pull_request: {
    number: 551,
    base_ref: 'main',
    base_oid: BASE,
    head_ref: 'feature/autonomous-contract',
    head_oid: HEAD,
  },
  activation_phase: 'AUTONOMOUS_ACTIVE',
  draft: false,
  queue_state: 'open',
  complete_paths_sha256: DIGEST('paths'),
  classifier_policy_sha256: DIGEST('classifier-policy'),
  signed_lease_sha256: DIGEST('classification-lease'),
  lineage: lineage(),
  ...overrides,
})

const classify = (input) => classifyPullRequest(canonicalJson(input))

const packetFixture = () => {
  const changedPaths = [
    { path: 'agent-contracts/autonomous-delivery-adjudication-packet.schema.json', status: 'added' },
    { path: 'scripts/lib/autonomous-delivery-contract.mjs', status: 'added' },
  ]
  const requiredCheckSources = [
    {
      context: 'ci/root',
      app_id: 100,
      check_run_id: 1001,
      head_oid: HEAD,
      workflow_path: '.github/workflows/ci.yml',
      verification_target: 'root-contracts',
      conclusion: 'success',
    },
    {
      context: 'governance/review',
      app_id: 200,
      check_run_id: 1002,
      head_oid: HEAD,
      workflow_path: '.github/workflows/agent-governance.yml',
      verification_target: 'agent-governance',
      conclusion: 'success',
    },
  ]
  const conversationState = {
    total_threads: 2,
    resolved_threads: 2,
    unresolved_threads: 0,
    threads_sha256: DIGEST('lossless-conversation-pages'),
  }
  const reviewSurface = {
    changed_paths_sha256: sha256(canonicalJson(changedPaths)),
    diff_sha256: DIGEST('lossless-diff'),
    policy_sha256: DIGEST('base-pinned-policy'),
    manifest_sha256: DIGEST('base-pinned-manifest'),
    required_checks_sha256: sha256(canonicalJson(requiredCheckSources)),
    conversation_sha256: sha256(canonicalJson(conversationState)),
  }
  const artifacts = [
    {
      artifact_id: 'collector:raw-diff',
      sha256: DIGEST('artifact-raw-diff'),
      size_bytes: 4096,
      media_type: 'application/octet-stream',
      acl_scope: 'issuer_and_executor',
      authentication: 'short_lived_lease',
      retention_class: 'audit_1y',
    },
    {
      artifact_id: 'review:l1',
      sha256: DIGEST('artifact-review-l1'),
      size_bytes: 1024,
      media_type: 'application/json',
      acl_scope: 'issuer_and_executor',
      authentication: 'short_lived_lease',
      retention_class: 'delivery_30d',
    },
  ]
  return {
    schema_version: 'autonomous-delivery-adjudication-packet/v1',
    repository: { full_name: 'monkey1sai/AI-BIM-governance', repository_id: 123456 },
    pull_request: {
      number: 551,
      base_ref: 'main',
      base_oid: BASE,
      head_ref: 'feature/autonomous-contract',
      head_oid: HEAD,
      merge_base_oid: BASE,
    },
    classification: { kind: 'ordinary' },
    classification_evidence: {
      source: 'server_authoritative',
      activation_phase: 'AUTONOMOUS_ACTIVE',
      draft: false,
      queue_state: 'open',
      complete_paths_sha256: sha256(canonicalJson(changedPaths)),
      classification_lease_sha256: DIGEST('classification-lease'),
    },
    changed_paths: changedPaths,
    changed_paths_sha256: sha256(canonicalJson(changedPaths)),
    required_check_sources: requiredCheckSources,
    conversation_state: conversationState,
    openspec_state: {
      required: true,
      change_name: 'autonomous-linux-delivery',
      alignment: 'aligned',
      evidence_sha256: DIGEST('openspec-alignment'),
    },
    review_surface: reviewSurface,
    artifacts,
    review_surface_sha256: sha256(canonicalJson(reviewSurface)),
    artifacts_sha256: sha256(canonicalJson(artifacts)),
    collector: {
      kind: 'github_app',
      app_id: 300,
      run_id: 987654,
      source_api: 'github_rest_graphql',
      collected_at: '2026-08-17T07:59:00.000Z',
    },
    budgets: {
      changed_path_count: changedPaths.length,
      changed_path_limit: 3000,
      diff_bytes: 8192,
      diff_byte_limit: 1_000_000,
      review_surface_bytes: 16384,
      review_surface_byte_limit: 2_000_000,
      artifact_count: artifacts.length,
      artifact_count_limit: 512,
    },
  }
}

const envelopeFixture = (packet) => ({
  schema_version: 'autonomous-delivery-attestation-envelope/v1',
  attestation_id: 'attestation:551.1',
  purpose: 'critical_machine_adjudication',
  audience: 'autonomous-delivery-merge-executor/v1',
  canonicalization: 'RFC8785',
  signature_domain: 'ai-bim-autonomous-delivery-attestation/v1',
  repository: structuredClone(packet.repository),
  pull_request: {
    number: packet.pull_request.number,
    base_oid: packet.pull_request.base_oid,
    head_oid: packet.pull_request.head_oid,
  },
  packet_sha256: sha256(canonicalJson(packet)),
  diff_sha256: packet.review_surface.diff_sha256,
  policy_sha256: packet.review_surface.policy_sha256,
  manifest_sha256: packet.review_surface.manifest_sha256,
  review_surface_sha256: packet.review_surface_sha256,
  artifacts_sha256: packet.artifacts_sha256,
  issuer: { kind: 'github_app', app_id: 300 },
  key_id: 'adjudicator-key-2026-08',
  algorithm: 'ed25519',
  nonce: 'n'.repeat(48),
  nonce_consumption: 'atomic_single_use',
  issued_at: '2026-08-17T07:59:30.000Z',
  expires_at: '2026-08-17T08:09:30.000Z',
  signature: 's'.repeat(86),
})

const terminalBase = (overrides = {}) => ({
  schema_version: 'autonomous-delivery-terminal-record/v1',
  delivery_id: 'delivery:551',
  attempt_id: 'attempt:551.1',
  pr_class: 'ordinary',
  supersedes_delivery_id: null,
  supersedes_attempt_id: null,
  previous_attempt_sha256: null,
  repository: { full_name: 'monkey1sai/AI-BIM-governance', repository_id: 123456 },
  pull_request: { number: 551, base_oid: BASE, head_oid: HEAD },
  phase: 'CLOSED',
  last_phase: 'VERIFYING_DEPLOYMENT',
  terminal_class: 'DELIVERED',
  reason_code: 'DELIVERY_VERIFIED',
  merge_observed: true,
  merge_commit_oid: MERGE,
  fetched_origin_main_oid: MERGE,
  deployed_commit_oid: MERGE,
  command_state: 'completed',
  target_id: 'canonical-linux-test',
  runner_ids: ['runner-linux', 'runner-windows'],
  gates: [
    { gate_id: 'linux-health', status: 'passed', result_sha256: DIGEST('linux-health') },
    { gate_id: 'windows-browser', status: 'passed', result_sha256: DIGEST('windows-browser') },
  ],
  artifacts: [
    {
      artifact_id: 'delivery:summary',
      sha256: DIGEST('delivery-summary'),
      size_bytes: 1024,
      media_type: 'application/json',
      retention_class: 'audit_1y',
    },
  ],
  failure_detail: [],
  closed_at: '2026-08-17T08:30:00.000Z',
  ...overrides,
})

const heldPremerge = (overrides = {}) => terminalBase({
  last_phase: 'VERIFYING',
  terminal_class: 'HELD',
  reason_code: 'PREMERGE_AUTHORITY_UNAVAILABLE',
  merge_observed: false,
  merge_commit_oid: null,
  fetched_origin_main_oid: null,
  deployed_commit_oid: null,
  command_state: 'not_started',
  target_id: null,
  runner_ids: [],
  gates: [{ gate_id: 'windows-design', status: 'held', result_sha256: DIGEST('windows-held') }],
  artifacts: [{
    artifact_id: 'premerge:runner-held',
    sha256: DIGEST('runner-held'),
    size_bytes: 256,
    media_type: 'application/json',
    retention_class: 'delivery_30d',
  }],
  failure_detail: [{ namespace: 'premerge', code: 'runner-unavailable', evidence_sha256: DIGEST('runner-held') }],
  ...overrides,
})

const failedDelivery = (overrides = {}) => terminalBase({
  terminal_class: 'FAILED',
  reason_code: 'MERGED_NOT_DELIVERED',
  deployed_commit_oid: null,
  runner_ids: ['runner-linux'],
  gates: [{ gate_id: 'linux-build', status: 'failed', result_sha256: DIGEST('linux-build-failed') }],
  artifacts: [{
    artifact_id: 'deploy:build-nonzero',
    sha256: DIGEST('build-nonzero'),
    size_bytes: 512,
    media_type: 'application/json',
    retention_class: 'audit_1y',
  }],
  failure_detail: [{ namespace: 'deploy', code: 'build-nonzero', evidence_sha256: DIGEST('build-nonzero') }],
  ...overrides,
})

test('closed classifier derives exactly eight classes from authoritative facts', () => {
  const cases = [
    [classifierInput({
      activation_phase: 'LEGACY_GUARDED', draft: true, signed_lease_sha256: null,
    }), { kind: 'draft_report_only' }],
    [classifierInput(), { kind: 'ordinary' }],
    [classifierInput({
      queue_state: 'frozen', lineage: lineage({ remediation_kind: 'repair', failure_delivery_id: 'delivery:failed' }),
    }), { kind: 'repair', failure_delivery_id: 'delivery:failed' }],
    [classifierInput({
      queue_state: 'frozen', lineage: lineage({
        reconciliation_delivery_id: 'delivery:held', debt_id: 'debt:fixpoint',
      }),
    }), { kind: 'reconciliation', delivery_id: 'delivery:held', debt_id: 'debt:fixpoint' }],
    [classifierInput({
      activation_phase: 'CANARY_ACTIVE', queue_state: 'activation_exclusive',
      lineage: lineage({ activation_plan_id: 'activation:plan-1' }),
    }), { kind: 'activation_canary', activation_plan_id: 'activation:plan-1' }],
    [classifierInput({
      activation_phase: 'CANARY_ACTIVE', queue_state: 'activation_exclusive',
      lineage: lineage({
        activation_plan_id: 'activation:plan-1', debt_id: 'debt:canary',
        canary_delivery_id: 'delivery:canary',
      }),
    }), {
      kind: 'activation_closure', activation_plan_id: 'activation:plan-1',
      debt_id: 'debt:canary', canary_delivery_id: 'delivery:canary',
    }],
    [classifierInput({
      queue_state: 'frozen', lineage: lineage({ remediation_kind: 'revert', failure_delivery_id: 'delivery:failed' }),
    }), { kind: 'revert', failure_delivery_id: 'delivery:failed' }],
    [classifierInput({
      queue_state: 'frozen', lineage: lineage({ release_id: 'release:2026-08-17' }),
    }), { kind: 'release_hotfix', release_id: 'release:2026-08-17' }],
  ]
  assert.deepEqual(cases.map(([input]) => classify(input).kind), autonomousDeliveryVocabulary.prClasses)
  for (const [input, expected] of cases) assert.deepEqual(classify(input), expected)
})

test('classifier rejects ambiguity, activation-only misuse, missing lease, and human fallback fields', () => {
  assert.deepEqual(classify(classifierInput({
    queue_state: 'frozen',
    lineage: lineage({ reconciliation_delivery_id: 'delivery:merge-ambiguous' }),
  })), { kind: 'reconciliation', delivery_id: 'delivery:merge-ambiguous' })
  expectCode('classification_ambiguous', () => classify(classifierInput({
    queue_state: 'frozen',
    lineage: lineage({
      remediation_kind: 'repair', failure_delivery_id: 'delivery:failed', debt_id: 'debt:also-set',
    }),
  })))
  expectCode('classification_lane_invalid', () => classify(classifierInput({
    lineage: lineage({ activation_plan_id: 'activation:plan-1' }),
  })))
  expectCode('classification_untrusted', () => classify(classifierInput({ signed_lease_sha256: null })))
  const humanFallback = classifierInput()
  humanFallback.requested_class = 'human_critical'
  expectCode('invalid_shape', () => classify(humanFallback))
})

test('packet parser accepts only canonical, immutable, digest-bound complete evidence', () => {
  const packet = packetFixture()
  const parsed = parseAdjudicationPacket(canonicalJson(packet))
  assert.deepEqual(parsed, packet)
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed.review_surface), true)

  const whitespace = `${canonicalJson(packet)}\n`
  expectCode('non_canonical_json', () => parseAdjudicationPacket(whitespace))
  const duplicateKey = canonicalJson(packet).replace('{', '{"schema_version":"duplicate",')
  expectCode('non_canonical_json', () => parseAdjudicationPacket(duplicateKey))
  expectCode('invalid_json_input', () => parseAdjudicationPacket('{'))
  const tooDeep = `${'{"nested":'.repeat(66)}0${'}'.repeat(66)}`
  expectCode('evidence_budget_exceeded', () => parseAdjudicationPacket(tooDeep))
})

test('packet parser fails closed on unknown fields, path ambiguity, drift, budgets, and secrets', () => {
  const unknown = packetFixture()
  unknown.untrusted = true
  expectCode('invalid_shape', () => parseAdjudicationPacket(canonicalJson(unknown)))

  const unsorted = packetFixture()
  unsorted.changed_paths.reverse()
  unsorted.changed_paths_sha256 = sha256(canonicalJson(unsorted.changed_paths))
  unsorted.classification_evidence.complete_paths_sha256 = unsorted.changed_paths_sha256
  unsorted.review_surface.changed_paths_sha256 = unsorted.changed_paths_sha256
  unsorted.review_surface_sha256 = sha256(canonicalJson(unsorted.review_surface))
  expectCode('invalid_order', () => parseAdjudicationPacket(canonicalJson(unsorted)))

  const duplicatePath = packetFixture()
  duplicatePath.changed_paths = [
    { path: 'docs/duplicate.md', status: 'added' },
    { path: 'docs/duplicate.md', status: 'modified' },
  ]
  expectCode('invalid_order', () => parseAdjudicationPacket(canonicalJson(duplicatePath)))

  const caseCollision = packetFixture()
  caseCollision.changed_paths = [
    { path: 'Docs/collision.md', status: 'added' },
    { path: 'docs/COLLISION.md', status: 'modified' },
  ]
  expectCode('ambiguous_path', () => parseAdjudicationPacket(canonicalJson(caseCollision)))

  const wrongHead = packetFixture()
  wrongHead.required_check_sources[0].head_oid = 'd'.repeat(40)
  expectCode('invalid_exact_tuple', () => parseAdjudicationPacket(canonicalJson(wrongHead)))

  const overBudget = packetFixture()
  overBudget.budgets.diff_bytes = overBudget.budgets.diff_byte_limit + 1
  expectCode('evidence_budget_exceeded', () => parseAdjudicationPacket(canonicalJson(overBudget)))

  const leaked = packetFixture()
  leaked.changed_paths[0].path = 'docs/github_pat_abcdefghijk.md'
  expectCode('secret_material_detected', () => parseAdjudicationPacket(canonicalJson(leaked)))

  const privateArtifactPath = packetFixture()
  privateArtifactPath.artifacts[0].artifact_id = 'C:/Users/IOT/private/deploy.log'
  expectCode('invalid_value', () => parseAdjudicationPacket(canonicalJson(privateArtifactPath)))
})

test('attestation binds purpose, audience, exact tuple, packet digests, TTL and signing bytes', () => {
  const packet = packetFixture()
  const packetRaw = canonicalJson(packet)
  const envelope = envelopeFixture(packet)
  const envelopeRaw = canonicalJson(envelope)
  const parsed = parseAttestationEnvelope(envelopeRaw, packetRaw, NOW)
  assert.deepEqual(parsed, envelope)
  assert.equal(attestationSigningBytes(envelopeRaw, packetRaw, NOW).toString('utf8').startsWith(
    'ai-bim-autonomous-delivery-attestation/v1\0',
  ), true)

  let nonceConsumed = false
  const authorized = authorizeAttestationEnvelope(envelopeRaw, packetRaw, {
    now: NOW,
    verifySignature: ({ algorithm, signingBytes }) => algorithm === 'ed25519' && signingBytes.length > 100,
    consumeNonce: () => {
      if (nonceConsumed) return false
      nonceConsumed = true
      return true
    },
  })
  assert.equal(authorized.envelope.packet_sha256, envelope.packet_sha256)
  expectCode('attestation_nonce_reused', () => authorizeAttestationEnvelope(envelopeRaw, packetRaw, {
    now: NOW,
    verifySignature: () => true,
    consumeNonce: () => false,
  }))
})

test('attestation rejects digest drift, wrong domain, bad signature authority and expired evidence', () => {
  const packet = packetFixture()
  const packetRaw = canonicalJson(packet)
  const drift = envelopeFixture(packet)
  drift.packet_sha256 = DIGEST('other-packet')
  expectCode('digest_mismatch', () => parseAttestationEnvelope(canonicalJson(drift), packetRaw, NOW))

  const wrongAudience = envelopeFixture(packet)
  wrongAudience.audience = 'candidate-controlled-consumer/v1'
  expectCode('attestation_domain_invalid', () => parseAttestationEnvelope(canonicalJson(wrongAudience), packetRaw, NOW))

  const validRaw = canonicalJson(envelopeFixture(packet))
  expectCode('attestation_signature_invalid', () => authorizeAttestationEnvelope(validRaw, packetRaw, {
    now: NOW, verifySignature: () => false, consumeNonce: () => true,
  }))

  const expired = envelopeFixture(packet)
  expired.issued_at = '2026-08-17T07:00:00.000Z'
  expired.expires_at = '2026-08-17T07:10:00.000Z'
  expectCode('attestation_expired', () => parseAttestationEnvelope(canonicalJson(expired), packetRaw, NOW))
})

test('terminal records expose only closed public classes and stage-aware reason mappings', () => {
  const delivered = terminalBase()
  assert.deepEqual(parseTerminalRecord(canonicalJson(delivered)), delivered)
  assert.deepEqual(allowedQueueLanes(canonicalJson(delivered)), ['ordinary'])
  assert.deepEqual(allowedQueueLanes(canonicalJson(terminalBase({
    pr_class: 'activation_canary',
  }))), ['activation_closure'])

  const held = heldPremerge()
  assert.deepEqual(allowedQueueLanes(canonicalJson(held)), [])
  const failed = failedDelivery()
  assert.deepEqual(allowedQueueLanes(canonicalJson(failed)), ['repair', 'revert'])

  const mergeAmbiguous = heldPremerge({
    last_phase: 'MERGING', reason_code: 'MERGE_OUTCOME_UNVERIFIED',
  })
  assert.deepEqual(allowedQueueLanes(canonicalJson(mergeAmbiguous)), ['reconciliation'])

  const fixpoint = terminalBase({
    terminal_class: 'HELD', reason_code: 'DELIVERY_PENDING_FIXPOINT',
    failure_detail: [{ namespace: 'fixpoint', code: 'closure-pending', evidence_sha256: DIGEST('fixpoint-pending') }],
    artifacts: [{
      artifact_id: 'fixpoint:closure-pending',
      sha256: DIGEST('fixpoint-pending'),
      size_bytes: 128,
      media_type: 'application/json',
      retention_class: 'audit_1y',
    }],
  })
  assert.deepEqual(allowedQueueLanes(canonicalJson(fixpoint)), ['reconciliation'])
})

test('terminal parser rejects enum confusion, stage crossover, partial delivery and raw detail', () => {
  expectCode('terminal_state_invalid', () => parseTerminalRecord(canonicalJson(terminalBase({
    terminal_class: 'MERGED',
  }))))
  expectCode('terminal_state_invalid', () => parseTerminalRecord(canonicalJson(terminalBase({
    terminal_class: 'HELD', reason_code: 'DELIVERY_VERIFIED',
  }))))
  expectCode('terminal_state_invalid', () => parseTerminalRecord(canonicalJson(heldPremerge({
    reason_code: 'DEPLOYMENT_BLOCKED',
  }))))
  expectCode('delivery_evidence_incomplete', () => parseTerminalRecord(canonicalJson(terminalBase({
    deployed_commit_oid: 'd'.repeat(40),
  }))))
  expectCode('failure_evidence_incomplete', () => parseTerminalRecord(canonicalJson(failedDelivery({
    fetched_origin_main_oid: 'd'.repeat(40),
  }))))
  expectCode('failure_evidence_incomplete', () => parseTerminalRecord(canonicalJson(failedDelivery({
    deployed_commit_oid: 'd'.repeat(40),
  }))))
  const rawDetail = heldPremerge()
  rawDetail.raw_log = 'C:\\private\\deploy.log'
  expectCode('invalid_shape', () => parseTerminalRecord(canonicalJson(rawDetail)))
  expectCode('classification_unknown', () => parseTerminalRecord(canonicalJson(terminalBase({
    pr_class: 'draft_report_only',
  }))))
  expectCode('invalid_value', () => parseTerminalRecord(canonicalJson(terminalBase({
    artifacts: [{
      ...terminalBase().artifacts[0],
      artifact_id: 'C:/Users/IOT/private/deploy.log',
    }],
  }))))
})

test('phase reducer rejects illegal transitions and retry starts without a superseded attempt', () => {
  assert.equal(assertPhaseTransition(null, 'COLLECTING'), true)
  assert.equal(assertPhaseTransition('VERIFYING', 'READY_TO_MERGE'), true)
  assert.equal(assertPhaseTransition('MERGED', 'DEPLOYING'), true)
  assert.equal(assertPhaseTransition(null, 'RETRYING_DEPLOYMENT', { supersedesAttempt: true }), true)
  expectCode('illegal_transition', () => assertPhaseTransition('VERIFYING', 'MERGED'))
  expectCode('illegal_transition', () => assertPhaseTransition('CLOSED', 'COLLECTING'))
  expectCode('illegal_transition', () => assertPhaseTransition(null, 'RETRYING_DEPLOYMENT'))
})

test('attempt append is immutable, digest chained, monotonic and non-forking', () => {
  const first = failedDelivery()
  const retry = terminalBase({
    attempt_id: 'attempt:551.2',
    supersedes_delivery_id: first.delivery_id,
    supersedes_attempt_id: first.attempt_id,
    previous_attempt_sha256: sha256(canonicalJson(first)),
    closed_at: '2026-08-17T08:45:00.000Z',
  })
  assert.deepEqual(validateAttemptAppend([first], retry), retry)

  expectCode('attempt_rewrite_forbidden', () => validateAttemptAppend([first], {
    ...first, reason_code: 'MERGED_NOT_DELIVERED',
  }))
  expectCode('attempt_rewrite_forbidden', () => validateAttemptAppend([first], {
    ...retry, previous_attempt_sha256: DIGEST('wrong-parent'),
  }))

  const fork = {
    ...retry,
    attempt_id: 'attempt:551.3',
    closed_at: '2026-08-17T09:00:00.000Z',
  }
  expectCode('attempt_lineage_invalid', () => validateAttemptAppend([first, retry], fork))

  const parallelRoot = terminalBase({
    attempt_id: 'attempt:551.parallel',
    closed_at: '2026-08-17T09:15:00.000Z',
  })
  expectCode('attempt_lineage_invalid', () => validateAttemptAppend([first], parallelRoot))

  const commitDrift = terminalBase({
    attempt_id: 'attempt:551.commit-drift',
    supersedes_delivery_id: first.delivery_id,
    supersedes_attempt_id: first.attempt_id,
    previous_attempt_sha256: sha256(canonicalJson(first)),
    merge_commit_oid: 'd'.repeat(40),
    fetched_origin_main_oid: 'd'.repeat(40),
    deployed_commit_oid: 'd'.repeat(40),
    closed_at: '2026-08-17T09:20:00.000Z',
  })
  expectCode('attempt_lineage_invalid', () => validateAttemptAppend([first], commitDrift))
})

test('cross-delivery repair lineage may advance only through a bound repair or revert class', () => {
  const first = failedDelivery()
  const repair = terminalBase({
    delivery_id: 'delivery:552',
    attempt_id: 'attempt:552.1',
    pr_class: 'repair',
    supersedes_delivery_id: first.delivery_id,
    supersedes_attempt_id: first.attempt_id,
    previous_attempt_sha256: sha256(canonicalJson(first)),
    pull_request: { number: 552, base_oid: MERGE, head_oid: 'd'.repeat(40) },
    closed_at: '2026-08-17T09:30:00.000Z',
  })
  assert.deepEqual(validateAttemptAppend([first], repair), repair)
  expectCode('attempt_lineage_invalid', () => validateAttemptAppend([first], {
    ...repair, pr_class: 'ordinary',
  }))
  expectCode('attempt_lineage_invalid', () => validateAttemptAppend([first], {
    ...repair, pr_class: 'reconciliation',
  }))
})

test('schemas and transition contract stay closed, versioned, and legacy-unwired', async () => {
  const baseUrl = new URL('../../agent-contracts/', import.meta.url)
  const names = [
    'autonomous-delivery-adjudication-packet.schema.json',
    'autonomous-delivery-attestation-envelope.schema.json',
    'autonomous-delivery-classifier-input.schema.json',
    'autonomous-delivery-terminal-record.schema.json',
  ]
  for (const name of names) {
    const schema = JSON.parse(await readFile(new URL(name, baseUrl), 'utf8'))
    assert.equal(schema.additionalProperties, false, `${name} must reject unknown top-level fields`)
    assert.match(schema.$id, /^autonomous-delivery-/u)
  }
  const transition = JSON.parse(await readFile(
    new URL('autonomous-delivery-transition.contract.json', baseUrl), 'utf8',
  ))
  assert.deepEqual(transition.phases, autonomousDeliveryVocabulary.phases)
  assert.deepEqual(transition.terminal_classes, autonomousDeliveryVocabulary.terminalClasses)
  assert.deepEqual(transition.reason_codes, autonomousDeliveryVocabulary.reasonCodes)
  assert.deepEqual(transition.pr_classes, autonomousDeliveryVocabulary.prClasses)
  assert.deepEqual(Object.keys(transition.queue_policy).sort(), [
    'DELIVERED/DELIVERY_VERIFIED',
    'FAILED/MERGED_NOT_DELIVERED',
    'HELD/DELIVERY_PENDING_FIXPOINT',
    'HELD/MERGE_OUTCOME_UNVERIFIED',
    'activation_canary/DELIVERED/DELIVERY_VERIFIED',
  ].sort())
  const contractQueueLanes = (record) => transition.queue_policy[
    `${record.pr_class}/${record.terminal_class}/${record.reason_code}`
  ] ?? transition.queue_policy[`${record.terminal_class}/${record.reason_code}`] ?? []
  const queueFixtures = [
    terminalBase(),
    terminalBase({ pr_class: 'activation_canary' }),
    failedDelivery(),
    heldPremerge({ last_phase: 'MERGING', reason_code: 'MERGE_OUTCOME_UNVERIFIED' }),
    terminalBase({
      terminal_class: 'HELD',
      reason_code: 'DELIVERY_PENDING_FIXPOINT',
      failure_detail: [{
        namespace: 'fixpoint', code: 'closure-pending', evidence_sha256: DIGEST('fixpoint-pending'),
      }],
      artifacts: [{
        artifact_id: 'fixpoint:closure-pending',
        sha256: DIGEST('fixpoint-pending'),
        size_bytes: 128,
        media_type: 'application/json',
        retention_class: 'audit_1y',
      }],
    }),
  ]
  for (const fixture of queueFixtures) {
    assert.deepEqual(contractQueueLanes(fixture), allowedQueueLanes(fixture))
  }
  assert.equal(transition.compatibility.legacy_trusted_host_merge_v1, 'preserved_unwired')
  assert.equal(transition.compatibility.active_policy_migration, false)
  assert.equal(transition.compatibility.activation_phase, 'LEGACY_GUARDED')

  const moduleText = await readFile(new URL('../lib/autonomous-delivery-contract.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(moduleText, /trusted-host-merge/iu)
  assert.doesNotMatch(moduleText, /child_process|fetch\(|process\.env/iu)
})
