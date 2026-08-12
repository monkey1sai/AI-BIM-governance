import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  TrustedMergeHold,
  bindRawBranchProtection,
  buildBoundedEvidence,
  buildBrokerAssertion,
  canonicalHumanApprovalBody,
  classifyElevatedPaths,
  heldResult,
  mergedResult,
  parseNameStatusZ,
  prepareInvocation,
  reviewSurfaceSnapshot,
  sha256,
  canonicalJson,
  selectCanonicalApproval,
  verifyApexVerdict,
  verifyBranchProtection,
  verifyBrokerApproval,
  verifyEnvironmentConfiguration,
  verifyPullRequestIdentity,
  verifyRequiredChecks,
  verifyReviewerPermission,
  verifyRulesets,
} from '../lib/trusted-host-merge.mjs'


const contract = JSON.parse(await readFile(
  new URL('../../agent-contracts/trusted-host-merge.contract.json', import.meta.url),
  'utf8',
))
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const NOW = new Date('2026-08-12T02:00:00.000Z')
const EXPIRES = '2026-08-12T02:10:00.000Z'
const NONCE = 'n'.repeat(32)

const rawInput = () => ({
  prNumber: '42',
  expectedHead: HEAD,
  expectedBase: BASE,
  provider: 'codex',
  nonce: NONCE,
  expiresAt: EXPIRES,
})

const context = () => ({
  eventName: 'workflow_dispatch',
  repository: contract.repository.full_name,
  ref: 'refs/heads/main',
  sha: BASE,
  runId: '987654',
  runAttempt: '1',
})

const environment = () => ({
  name: contract.broker.environment,
  can_admins_bypass: false,
  protection_rules: [{
    type: 'required_reviewers',
    prevent_self_review: true,
    reviewers: [{
      type: 'User',
      reviewer: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
    }],
  }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
})

const protection = () => ({
  required_status_checks: {
    strict: true,
    contexts: ['ci/root', 'governance/review'],
    checks: [
      { context: 'ci/root', app_id: 100 },
      { context: 'governance/review', app_id: 200 },
    ],
  },
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: true,
    bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
  },
  required_conversation_resolution: { enabled: true },
  enforce_admins: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
})

const checkSources = [
  { context: 'ci/root', app_id: 100 },
  { context: 'governance/review', app_id: 200 },
]

const pr = (invocation) => ({
  number: invocation.prNumber,
  state: 'open',
  draft: false,
  merged: false,
  head: { sha: invocation.headOid, ref: 'feat/safe-change', repo: { full_name: invocation.repo } },
  base: { sha: invocation.baseOid, ref: 'main', repo: { full_name: invocation.repo } },
  reviewDecision: 'APPROVED',
  mergeStateStatus: 'CLEAN',
})

const review = (invocation) => ({
  id: 77,
  node_id: 'PRR_node',
  state: 'APPROVED',
  body: canonicalHumanApprovalBody(invocation),
  commit_id: invocation.headOid,
  author_association: 'COLLABORATOR',
  submitted_at: '2026-08-12T01:59:00Z',
  user: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
})

const expectHold = (reason, callback) => {
  assert.throws(callback, (error) => error instanceof TrustedMergeHold && error.reason === reason)
}

test('dispatch identity produces an exact, short-lived broker assertion', () => {
  const invocation = prepareInvocation(rawInput(), context(), contract, NOW)
  assert.deepEqual(invocation, {
    repo: 'monkey1sai/AI-BIM-governance',
    prNumber: 42,
    headOid: HEAD,
    baseOid: BASE,
    action: 'merge-elevated',
    runId: 987654,
    provider: 'codex',
    nonce: NONCE,
    expiresAt: EXPIRES,
  })
  assert.equal(buildBrokerAssertion(invocation, contract), JSON.stringify({
    kind: 'ai-bim-trusted-elevated-merge',
    version: 1,
    repo: invocation.repo,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    action: invocation.action,
    runId: invocation.runId,
    provider: invocation.provider,
    nonce: invocation.nonce,
    expiresAt: invocation.expiresAt,
  }))
})

test('dispatch rejects extra fields, mutable base, reruns, weak nonce, and stale expiry', () => {
  expectHold('invalid_args_format', () => prepareInvocation({ ...rawInput(), extra: true }, context(), contract, NOW))
  expectHold('stale_base', () => prepareInvocation(rawInput(), { ...context(), sha: HEAD }, contract, NOW))
  expectHold('wrong_checkout', () => prepareInvocation(rawInput(), { ...context(), runAttempt: '2' }, contract, NOW))
  expectHold('invalid_args_format', () => prepareInvocation({ ...rawInput(), nonce: 'short' }, context(), contract, NOW))
  expectHold('trusted_elevated_authorization_unavailable', () => (
    prepareInvocation({ ...rawInput(), expiresAt: '2026-08-12T02:30:00.000Z' }, context(), contract, NOW)
  ))
})

test('protected environment and one-use approval bind the exact challenge', () => {
  const invocation = prepareInvocation(rawInput(), context(), contract, NOW)
  const assertion = buildBrokerAssertion(invocation, contract)
  verifyEnvironmentConfiguration(environment(), [{ name: 'main', type: 'branch' }], contract)
  verifyBrokerApproval([{
    state: 'approved',
    comment: assertion,
    environments: [{ name: 'trusted-elevated-merge' }],
    user: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
  }], assertion, invocation, contract, NOW)

  expectHold('trusted_elevated_authorization_unavailable', () => {
    const unsafe = environment()
    unsafe.can_admins_bypass = true
    verifyEnvironmentConfiguration(unsafe, [{ name: 'main', type: 'branch' }], contract)
  })
  expectHold('trusted_elevated_authorization_unavailable', () => {
    const unsafe = environment()
    unsafe.protection_rules[0].prevent_self_review = false
    verifyEnvironmentConfiguration(unsafe, [{ name: 'main', type: 'branch' }], contract)
  })
  expectHold('trusted_elevated_authorization_unavailable', () => (
    verifyBrokerApproval([], assertion, invocation, contract, NOW)
  ))
  expectHold('trusted_elevated_authorization_unavailable', () => (
    verifyBrokerApproval([{
      state: 'approved', comment: `${assertion} `,
      environments: [{ name: 'trusted-elevated-merge' }],
      user: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
    }], assertion, invocation, contract, NOW)
  ))
})

test('NUL parser preserves both rename paths for elevated classification', () => {
  const entries = parseNameStatusZ(`R100\0src/ordinary.mjs\0.github/workflows/ci.yml\0M\0README.md\0`)
  assert.deepEqual(entries, [
    { status: 'R100', oldPath: 'src/ordinary.mjs', path: '.github/workflows/ci.yml' },
    { status: 'M', path: 'README.md' },
  ])
  assert.equal(classifyElevatedPaths(entries).elevated, true)
  expectHold('scope_drift', () => parseNameStatusZ('M\0scripts/x.mjs'))
  expectHold('scope_drift', () => parseNameStatusZ('M\0../escape\0'))
  for (const path of [
    '.agents/skills/reviewer/SKILL.md',
    'agent-contracts/spec-to-done.contract.json',
  ]) {
    assert.equal(classifyElevatedPaths([{ status: 'M', path }]).elevated, true)
  }
})

test('branch policy requires source-pinned checks and forbids every bypass', () => {
  const snapshot = verifyBranchProtection(protection(), checkSources)
  assert.deepEqual(snapshot.requiredChecks, [
    { context: 'ci/root', appId: 100 },
    { context: 'governance/review', appId: 200 },
  ])
  assert.deepEqual(verifyRulesets([{
    id: 9, name: 'main', target: 'branch', enforcement: 'active',
    bypass_actors: [], conditions: {}, rules: [],
  }]), [{
    id: 9, name: 'main', target: 'branch', enforcement: 'active',
    bypassActors: [], conditions: {}, rules: [],
  }])

  expectHold('branch_protection_single_owner_gate_not_strict', () => {
    const unsafe = protection()
    unsafe.required_status_checks.checks[0].app_id = null
    verifyBranchProtection(unsafe, checkSources)
  })
  expectHold('branch_protection_single_owner_gate_not_strict', () => {
    const unsafe = protection()
    unsafe.required_pull_request_reviews.bypass_pull_request_allowances.apps.push({ id: 1 })
    verifyBranchProtection(unsafe, checkSources)
  })
  expectHold('branch_protection_single_owner_gate_not_strict', () => verifyBranchProtection(protection(), []))
  expectHold('branch_protection_single_owner_gate_not_strict', () => verifyBranchProtection(protection(), [
    { context: 'ci/root', app_id: 999 },
    { context: 'governance/review', app_id: 200 },
  ]))
  expectHold('branch_protection_single_owner_gate_not_strict', () => verifyRulesets([{
    id: 9, name: 'main', target: 'branch', enforcement: 'active',
    bypass_actors: [{ actor_type: 'OrganizationAdmin' }], conditions: {}, rules: [],
  }]))
})

test('PR, code-owner approval, reviewer permission, and App-pinned checks are exact', () => {
  const invocation = prepareInvocation(rawInput(), context(), contract, NOW)
  verifyPullRequestIdentity(pr(invocation), invocation, { final: true })
  const approval = selectCanonicalApproval([review(invocation)], invocation, contract)
  assert.equal(approval.id, 77)
  verifyReviewerPermission({
    permission: 'write', role_name: 'write',
    user: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
  }, contract)
  const snapshot = verifyBranchProtection(protection(), checkSources)
  verifyRequiredChecks([
    { id: 10, name: 'ci/root', app: { id: 100 }, head_sha: HEAD, status: 'completed', conclusion: 'success' },
    { id: 11, name: 'governance/review', app: { id: 200 }, head_sha: HEAD, status: 'completed', conclusion: 'neutral' },
  ], snapshot, HEAD)

  expectHold('pr_identity_not_ready', () => verifyPullRequestIdentity({ ...pr(invocation), draft: true }, invocation))
  for (const branch of ['revert-bad-release', 'release/2026.08', 'release-2026.08', 'hotfix/urgent', 'hotfix-urgent']) {
    const restricted = pr(invocation)
    restricted.head.ref = branch
    expectHold('branch_requires_separate_authorization', () => verifyPullRequestIdentity(restricted, invocation))
  }
  expectHold('human_approval_required', () => selectCanonicalApproval([{ ...review(invocation), body: 'approve' }], invocation, contract))
  expectHold('reviewer_permission_not_strict', () => verifyReviewerPermission({
    permission: 'admin', role_name: 'admin',
    user: { login: 'monkey1sai-blip', id: 311287868, type: 'User' },
  }, contract))
  expectHold('final_gate_not_clean', () => verifyRequiredChecks([
    { id: 10, name: 'ci/root', app: { id: 999 }, head_sha: HEAD, status: 'completed', conclusion: 'success' },
  ], snapshot, HEAD))
})

test('immutable raw branch protection detects drift outside normalized gate fields', () => {
  const before = bindRawBranchProtection({
    ...protection(),
    required_linear_history: { enabled: false },
    restrictions: null,
  })
  const after = bindRawBranchProtection({
    ...protection(),
    required_linear_history: { enabled: true },
    restrictions: null,
  })
  assert.notEqual(
    sha256(canonicalJson({ rawBranchProtection: before })),
    sha256(canonicalJson({ rawBranchProtection: after })),
  )
})

test('review surface is drift-detectable and apex evidence is bounded and redacted', () => {
  const before = reviewSurfaceSnapshot({ pullComments: [], reviews: [{ id: 1, body: 'ok' }], issueComments: [] })
  const after = reviewSurfaceSnapshot({ pullComments: [], reviews: [{ id: 1, body: 'changed' }], issueComments: [] })
  assert.notEqual(before.sha256, after.sha256)

  const evidence = buildBoundedEvidence({ diff: 'token=ghp_abcdefghijklmnopqrstuvwx' }, 500000)
  assert.ok(evidence.serialized.includes('[REDACTED]'))
  assert.ok(!evidence.serialized.includes('ghp_'))
  expectHold('evidence_too_large_for_arbiter', () => buildBoundedEvidence({ diff: 'x'.repeat(100) }, 20))
})

test('apex verdict must echo every immutable approval field before merge', () => {
  const invocation = prepareInvocation(rawInput(), context(), contract, NOW)
  const approval = selectCanonicalApproval([review(invocation)], invocation, contract)
  const verdict = {
    allowMerge: true,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    approvalReviewId: approval.id,
    approvalReviewNodeId: approval.nodeId,
    approvalBody: approval.body,
    approvalCommitId: approval.commitId,
    heldReason: null,
    evidence: ['All immutable gates are consistent.'],
  }
  verifyApexVerdict(verdict, invocation, approval)
  expectHold('arbiter_denied', () => verifyApexVerdict({ ...verdict, headOid: BASE }, invocation, approval))

  assert.equal(heldResult(invocation, 'final_gate_not_clean', 'check_failed').status, 'held')
  assert.equal(mergedResult(invocation, 'c'.repeat(40)).status, 'merged')
  assert.equal(mergedResult(invocation, 'c'.repeat(40), 'fetch_failed').status, 'merged_but_closeout_held')
})
