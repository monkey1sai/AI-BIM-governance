import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LinuxContinuousDeploymentError,
  acquireSingleFlight,
  appendDeliveryLedger,
  evaluateRetry,
  linuxContinuousDeploymentVocabulary,
  parseArtifactProvenance,
  parseDeploymentTarget,
  parseTerminalDeliveryAttestation,
  parseTrustedMergeEvent,
  runLinuxContinuousDeployment,
} from '../lib/linux-continuous-deployment.mjs'
import {
  buildProvisioningBoundaryFromGithubEvent,
  writeControllerResult,
} from '../dev/linux-continuous-deployment-controller.mjs'

const SHA = (value) => value.repeat(64).slice(0, 64)
const OID = (value) => value.repeat(40).slice(0, 40)
const NOW = new Date('2026-09-01T02:00:00.000Z')

const trustedMerge = (overrides = {}) => ({
  schema_version: 'linux-cd-trusted-merge-event/v1',
  repository: 'monkey1sai/AI-BIM-governance',
  event_name: 'pull_request.closed',
  event_id: 'evt-737-merge',
  pull_request: 737,
  merged: true,
  base_ref: 'main',
  source_head_ref: 'codex/openspec/autonomous-linux-delivery-impl',
  source_head_sha: OID('a'),
  trusted_merge_sha: OID('b'),
  merge_authority: {
    kind: 'github_server_trusted_merge',
    actor_id: '26239865',
    evidence_sha256: SHA('1'),
  },
  collector: {
    complete: true,
    pages_fetched: 3,
    expected_pages: 3,
    evidence_sha256: SHA('2'),
  },
  ci_convergence: {
    head_sha: OID('a'),
    converged: true,
    attestation_sha256: SHA('3'),
    required_checks: [
      { name: 'agent-governance', conclusion: 'success', source_app_id: 15368 },
      { name: 'CI', conclusion: 'success', source_app_id: 15368 },
    ],
  },
  observed_at: '2026-09-01T01:00:00.000Z',
  ...overrides,
})

const artifact = (overrides = {}) => ({
  schema_version: 'linux-cd-artifact-provenance/v1',
  repository: 'monkey1sai/AI-BIM-governance',
  merge_sha: OID('b'),
  source_tree_sha: OID('c'),
  artifact_sha256: SHA('4'),
  observed_sha256: SHA('4'),
  artifact_size_bytes: 4096,
  artifact_uri: 'artifact:linux-cd/run-9001/release.tar',
  build_run: { provider: 'github-actions', run_id: '9001', run_attempt: 1 },
  provenance: { issuer: 'github-oidc', key_id: 'key-2026-09', evidence_sha256: SHA('5') },
  built_at: '2026-09-01T01:10:00.000Z',
  ...overrides,
})

const target = (overrides = {}) => ({
  schema_version: 'linux-cd-deployment-target/v1',
  source: 'server_authoritative_inventory',
  target_id: 'canonical-linux',
  role: 'canonical_test_deploy',
  kind: 'linux_host_native',
  environment: 'test-linux',
  service: 'ai-bim-governance',
  expected_fingerprint: SHA('6'),
  observed_fingerprint: SHA('6'),
  profile_sha256: SHA('7'),
  deployment_method: 'scripts/dev/rebuild-test-deploy.ps1 -Build',
  credential_authority: {
    kind: 'opaque_target_lease',
    issuer: 'owner-provisioned-broker',
    key_id: 'target-key-1',
    lease_id: 'lease-737',
    expires_at: '2026-09-01T03:00:00.000Z',
  },
  ...overrides,
})

const verification = (overrides = {}) => ({
  observation_started_at: '2026-09-01T01:20:00.000Z',
  observation_ended_at: '2026-09-01T01:30:00.000Z',
  artifact_sha256: SHA('4'),
  gates: [
    { id: 'health', status: 'passed', evidence_sha256: SHA('8') },
    { id: 'smoke', status: 'passed', evidence_sha256: SHA('9') },
    { id: 'e2e', status: 'passed', evidence_sha256: SHA('a') },
  ],
  ...overrides,
})

const knownGood = (overrides = {}) => ({
  artifact_sha256: SHA('d'),
  provenance_sha256: SHA('e'),
  release_id: 'release-known-good-42',
  target_fingerprint: SHA('6'),
  ...overrides,
})

const request = (overrides = {}) => ({
  schema_version: 'linux-continuous-deployment-request/v1',
  delivery_id: 'delivery-737',
  repository: 'monkey1sai/AI-BIM-governance',
  replay_key: 'merge:737:b',
  trusted_merge: trustedMerge(),
  artifact: artifact(),
  target: target(),
  controller: { owner_id: 'controller-1', lease_id: 'controller-lease-1' },
  ledger: [],
  canary: verification(),
  promotion: { artifact_sha256: SHA('4'), approved_at: '2026-09-01T01:31:00.000Z' },
  post_deploy: verification({
    observation_started_at: '2026-09-01T01:32:00.000Z',
    observation_ended_at: '2026-09-01T01:42:00.000Z',
  }),
  previous_known_good: knownGood(),
  rollback: {
    attempted: false,
    artifact_sha256: SHA('d'),
    verification: null,
  },
  retry_history: [],
  timestamps: { requested_at: '2026-09-01T01:00:00.000Z' },
  ...overrides,
})

const expectCode = (code, fn) => assert.throws(fn, (error) => {
  assert.equal(error instanceof LinuxContinuousDeploymentError, true)
  assert.equal(error.code, code)
  return true
})

test('trusted merge parser rejects wrong repository, base, authority, stale SHA and partial pagination', () => {
  assert.equal(parseTrustedMergeEvent(trustedMerge()).trusted_merge_sha, OID('b'))
  expectCode('trusted_merge_repository_invalid', () => parseTrustedMergeEvent(trustedMerge({ repository: 'other/repo' })))
  expectCode('trusted_merge_base_invalid', () => parseTrustedMergeEvent(trustedMerge({ base_ref: 'release' })))
  expectCode('trusted_merge_authority_invalid', () => parseTrustedMergeEvent(trustedMerge({
    merge_authority: { kind: 'human_comment', actor_id: '1', evidence_sha256: SHA('1') },
  })))
  expectCode('stale_ci_convergence', () => parseTrustedMergeEvent(trustedMerge({
    ci_convergence: { ...trustedMerge().ci_convergence, head_sha: OID('f') },
  })))
  expectCode('collector_incomplete', () => parseTrustedMergeEvent(trustedMerge({
    collector: { ...trustedMerge().collector, complete: false, pages_fetched: 2 },
  })))
})

test('artifact and target contracts reject digest mismatch, topology, drift and missing credential authority', () => {
  assert.equal(parseArtifactProvenance(artifact(), trustedMerge()).artifact_sha256, SHA('4'))
  expectCode('artifact_digest_mismatch', () => parseArtifactProvenance(artifact({ observed_sha256: SHA('f') }), trustedMerge()))
  expectCode('artifact_merge_mismatch', () => parseArtifactProvenance(artifact({ merge_sha: OID('f') }), trustedMerge()))
  assert.equal(parseDeploymentTarget(target(), { now: NOW }).target_id, 'canonical-linux')
  expectCode('target_fingerprint_drift', () => parseDeploymentTarget(target({ observed_fingerprint: SHA('f') }), { now: NOW }))
  expectCode('credential_authority_unavailable', () => parseDeploymentTarget(target({ credential_authority: null }), { now: NOW }))
  expectCode('secret_or_topology_detected', () => parseDeploymentTarget({ ...target(), hostname: 'private.example' }, { now: NOW }))
})

test('single-flight is environment and service scoped, idempotent and replay guarded', () => {
  const acquired = acquireSingleFlight([], request())
  assert.equal(acquired.idempotent, false)
  const replay = acquireSingleFlight([acquired.entry], request())
  assert.equal(replay.idempotent, true)
  expectCode('duplicate_controller', () => acquireSingleFlight([acquired.entry], request({
    delivery_id: 'delivery-738', replay_key: 'merge:738:c',
    controller: { owner_id: 'controller-2', lease_id: 'controller-lease-2' },
  })))
  expectCode('replay_detected', () => acquireSingleFlight([{ ...acquired.entry, state: 'ACTIVATED' }], request({
    delivery_id: 'delivery-738', controller: { owner_id: 'controller-2', lease_id: 'controller-lease-2' },
  })))
})

test('successful delivery uses the exact canary digest through promotion and terminal attestation', () => {
  const result = runLinuxContinuousDeployment(request(), { now: NOW })
  assert.equal(result.final_state, 'ACTIVATED')
  assert.deepEqual(result.states, linuxContinuousDeploymentVocabulary.successPath)
  assert.equal(result.attestation.artifact_sha256, SHA('4'))
  assert.equal(result.attestation.terminal_class, 'DELIVERED')
  assert.equal(result.attestation.reason_code, 'DELIVERY_VERIFIED')
  assert.equal(parseTerminalDeliveryAttestation(result.attestation).final_state, 'ACTIVATED')
})

test('canary failure rolls back only to pinned known-good artifact and verifies rollback', () => {
  const rollbackVerification = verification({ artifact_sha256: SHA('d') })
  const result = runLinuxContinuousDeployment(request({
    canary: verification({ gates: [
      { id: 'health', status: 'failed', evidence_sha256: SHA('8') },
      { id: 'smoke', status: 'held', evidence_sha256: SHA('9') },
      { id: 'e2e', status: 'held', evidence_sha256: SHA('a') },
    ] }),
    rollback: { attempted: true, artifact_sha256: SHA('d'), verification: rollbackVerification },
  }), { now: NOW })
  assert.equal(result.final_state, 'ROLLED_BACK')
  assert.equal(result.attestation.terminal_class, 'FAILED')
  assert.equal(result.attestation.reason_code, 'MERGED_NOT_DELIVERED')
  assert.deepEqual(result.states.slice(-3), [
    'ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT', 'VERIFY_ROLLBACK', 'ROLLED_BACK',
  ])
})

test('promotion digest mismatch rolls back, while rollback failure becomes HELD', () => {
  const rolledBack = runLinuxContinuousDeployment(request({
    promotion: { artifact_sha256: SHA('f'), approved_at: '2026-09-01T01:31:00.000Z' },
    rollback: {
      attempted: true,
      artifact_sha256: SHA('d'),
      verification: verification({ artifact_sha256: SHA('d') }),
    },
  }), { now: NOW })
  assert.equal(rolledBack.final_state, 'ROLLED_BACK')

  const held = runLinuxContinuousDeployment(request({
    canary: verification({ gates: [
      { id: 'health', status: 'failed', evidence_sha256: SHA('8') },
      { id: 'smoke', status: 'held', evidence_sha256: SHA('9') },
      { id: 'e2e', status: 'held', evidence_sha256: SHA('a') },
    ] }),
    rollback: {
      attempted: true,
      artifact_sha256: SHA('d'),
      verification: verification({ artifact_sha256: SHA('d'), gates: [
        { id: 'health', status: 'failed', evidence_sha256: SHA('8') },
        { id: 'smoke', status: 'held', evidence_sha256: SHA('9') },
        { id: 'e2e', status: 'held', evidence_sha256: SHA('a') },
      ] }),
    },
  }), { now: NOW })
  assert.equal(held.final_state, 'HELD')
  assert.equal(held.attestation.outcome.rollback, 'unverified')
  assert.equal(held.attestation.reason_code, 'ROLLBACK_UNVERIFIED')
})

test('retry is bounded, failure-class deduplicated and requires changed event evidence', () => {
  const first = evaluateRetry([], {
    failure_class: 'network_transient', evidence_sha256: SHA('1'), event_id: 'event-1',
  })
  assert.equal(first.allowed, true)
  expectCode('retry_evidence_unchanged', () => evaluateRetry([first.record], {
    failure_class: 'network_transient', evidence_sha256: SHA('1'), event_id: 'event-2',
  }))
  expectCode('retry_budget_exhausted', () => evaluateRetry([first.record], {
    failure_class: 'network_transient', evidence_sha256: SHA('2'), event_id: 'event-3',
  }))
})

test('append-only delivery ledger rejects rewrites and forks', () => {
  const first = appendDeliveryLedger([], {
    delivery_id: 'delivery-737', event_id: 'event-1', state: 'TRUSTED_MERGED',
    evidence_sha256: SHA('1'), previous_sha256: null,
  })
  const second = appendDeliveryLedger([first], {
    delivery_id: 'delivery-737', event_id: 'event-2', state: 'BUILD_IMMUTABLE_ARTIFACT',
    evidence_sha256: SHA('2'), previous_sha256: first.record_sha256,
  })
  assert.equal(second.previous_sha256, first.record_sha256)
  expectCode('ledger_rewrite_forbidden', () => appendDeliveryLedger([first], { ...first }))
  expectCode('ledger_lineage_invalid', () => appendDeliveryLedger([first], {
    delivery_id: 'delivery-737', event_id: 'event-3', state: 'BUILD_IMMUTABLE_ARTIFACT',
    evidence_sha256: SHA('3'), previous_sha256: SHA('f'),
  }))
})

test('missing activation provisioning closes as PROVISIONING_REQUIRED to HELD', () => {
  const result = runLinuxContinuousDeployment(request({ target: null }), { now: NOW })
  assert.equal(result.final_state, 'HELD')
  assert.equal(result.attestation.terminal_class, 'HELD')
  assert.deepEqual(result.states.slice(-2), ['PROVISIONING_REQUIRED', 'HELD'])
  assert.equal(result.attestation.outcome.promotion, 'not_started')

  const noArtifact = runLinuxContinuousDeployment(request({ artifact: null }), { now: NOW })
  assert.deepEqual(noArtifact.states.slice(-2), ['PROVISIONING_REQUIRED', 'HELD'])
  assert.equal(noArtifact.attestation.reason_code, 'PROVISIONING_REQUIRED')
})

test('pre-deploy requires a pinned known-good artifact for deterministic rollback', () => {
  const result = runLinuxContinuousDeployment(request({ previous_known_good: null }), { now: NOW })
  assert.equal(result.final_state, 'HELD')
  assert.equal(result.attestation.reason_code, 'DEPLOYMENT_BLOCKED')
  assert.equal(result.states.includes('DEPLOY_CANARY'), false)
})

test('repo-owned controller materializes a no-clobber provisioning-held attestation', async () => {
  const githubEvent = {
    action: 'closed',
    repository: { full_name: 'monkey1sai/AI-BIM-governance' },
    pull_request: {
      number: 737,
      merged: true,
      merged_at: '2026-09-01T01:00:00Z',
      merge_commit_sha: OID('b'),
      base: { ref: 'main' },
      head: { sha: OID('a') },
    },
  }
  const result = buildProvisioningBoundaryFromGithubEvent(githubEvent, { now: NOW })
  assert.equal(result.final_state, 'HELD')
  assert.equal(result.attestation.reason_code, 'PROVISIONING_REQUIRED')
  assert.equal(result.attestation.trusted_merge_sha, OID('b'))

  assert.throws(() => buildProvisioningBoundaryFromGithubEvent({
    ...githubEvent,
    repository: { full_name: 'other/repo' },
  }), /repository is not the expected repository/u)

  const temp = await mkdtemp(path.join(os.tmpdir(), 'linux-cd-controller-'))
  const output = path.join(temp, 'terminal.json')
  try {
    await writeControllerResult(output, result)
    await assert.rejects(writeControllerResult(output, result), { code: 'EEXIST' })
    assert.equal(JSON.parse(await readFile(output, 'utf8')).attestation.reason_code, 'PROVISIONING_REQUIRED')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('closed schemas, workflow and skill pressure fixture remain machine-verifiable', async () => {
  const contractRoot = new URL('../../agent-contracts/', import.meta.url)
  for (const name of [
    'linux-continuous-deployment-request.schema.json',
    'linux-continuous-deployment-attestation.schema.json',
  ]) {
    const schema = JSON.parse(await readFile(new URL(name, contractRoot), 'utf8'))
    assert.equal(schema.additionalProperties, false)
    assert.match(schema.$id, /^linux-continuous-deployment-/u)
  }
  const transition = JSON.parse(await readFile(
    new URL('linux-continuous-deployment.contract.json', contractRoot), 'utf8',
  ))
  assert.deepEqual(transition.states, linuxContinuousDeploymentVocabulary.states)
  assert.equal(transition.activation.default_state, 'PROVISIONING_REQUIRED')
  assert.equal(transition.deployment.method, 'scripts/dev/rebuild-test-deploy.ps1 -Build')

  const workflow = await readFile(new URL('../../.github/workflows/linux-continuous-deployment.yml', import.meta.url), 'utf8')
  assert.match(workflow, /pull_request:\s*\n\s+types:\s*\[closed\]/u)
  assert.match(workflow, /github\.event\.pull_request\.merged == true/u)
  assert.match(workflow, /PROVISIONING_REQUIRED/u)
  assert.doesNotMatch(workflow, /secrets\.[A-Za-z0-9_]+/u)
  assert.match(workflow, /linux-continuous-deployment-controller\.mjs/u)
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u)

  const registry = JSON.parse(await readFile(new URL('../script-registry.json', import.meta.url), 'utf8'))
  const wrapper = registry.scripts.find((entry) => entry.path === 'scripts/dev/linux-continuous-deployment-controller.mjs')
  assert.equal(wrapper.role, 'post-merge-contract-wrapper')

  const pressure = JSON.parse(await readFile(
    new URL('./fixtures/linux-continuous-deployment-pressure-scenarios.json', import.meta.url), 'utf8',
  ))
  assert.equal(pressure.scenarios.length, 13)
  assert.deepEqual(new Set(pressure.scenarios.map((item) => item.expected_final_state)),
    new Set(['ACTIVATED', 'ROLLED_BACK', 'HELD']))

  const claudeSkill = await readFile(
    new URL('../../.claude/skills/autonomous-pr-queue/SKILL.md', import.meta.url), 'utf8',
  )
  const codexSkill = await readFile(
    new URL('../../.codex/skills/autonomous-pr-queue/SKILL.md', import.meta.url), 'utf8',
  )
  assert.equal(claudeSkill, codexSkill)
  for (const state of [
    'TRUSTED_MERGED',
    'BUILD_IMMUTABLE_ARTIFACT',
    'DEPLOY_CANARY',
    'PROMOTE',
    'TERMINAL_DELIVERY_ATTESTATION',
    'ROLLBACK_TO_PINNED_KNOWN_GOOD_ARTIFACT',
    'PROVISIONING_REQUIRED',
  ]) assert.match(claudeSkill, new RegExp(`\\b${state}\\b`, 'u'))
  assert.match(claudeSkill, /same immutable artifact digest/iu)
  assert.match(claudeSkill, /bounded, failure-class deduplicated, and event-driven/iu)
})

test('contract module stays pure and cannot execute deployment or read ambient secrets', async () => {
  const source = await readFile(new URL('../lib/linux-continuous-deployment.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(|fetch\(|process\.env/iu)
})
