import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  TrustedMergeHold,
  activationTupleSha256,
  bindRawBranchProtection,
  bindVerifiedPullRequestIdentity,
  buildBoundedEvidence,
  buildBrokerAssertion,
  canonicalHumanApprovalBody,
  classifyElevatedPaths,
  heldResult,
  mergeOutcomeUnverifiedResult,
  mergedResult,
  parseNameStatusZ,
  parseNumstatZ,
  parseRawDiffZ,
  prepareInvocation,
  rejectBinaryDiff,
  rejectOpaqueGitModes,
  reviewSurfaceSnapshot,
  sanitizeUntrustedText,
  sha256,
  canonicalJson,
  selectCanonicalApproval,
  verifyApexVerdict,
  verifyActivationGate,
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

const rawInput = (expectedActivationMode = contract.activation.active_mode) => ({
  prNumber: '42',
  expectedHead: HEAD,
  expectedBase: BASE,
  expectedActivationMode,
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
  body: 'Original pull request body',
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
    activationMode: 'active',
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
    activationMode: invocation.activationMode,
    provider: invocation.provider,
    nonce: invocation.nonce,
    expiresAt: invocation.expiresAt,
  }))
})

test('activation gate permits only exact attestation tuples or fully active state', () => {
  const pendingInvocations = contract.activation.pending_modes.map((mode) => (
    prepareInvocation(rawInput(mode), context(), contract, NOW)
  ))
  const pendingDigests = pendingInvocations.map((invocation) => activationTupleSha256(invocation, contract))
  assert.notEqual(pendingDigests[0], pendingDigests[1])
  assert.notEqual(
    buildBrokerAssertion(pendingInvocations[0], contract),
    buildBrokerAssertion(pendingInvocations[1], contract),
  )
  for (let index = 0; index < pendingInvocations.length; index += 1) {
    const invocation = pendingInvocations[index]
    const externalMode = contract.activation.pending_modes[index]
    assert.equal(verifyActivationGate({
      activationState: contract.activation.pending_state,
      externalMode,
      attestationTupleSha256: pendingDigests[index],
      invocation,
      contract,
    }), externalMode)
  }
  const invocation = prepareInvocation(rawInput(), context(), contract, NOW)
  assert.equal(verifyActivationGate({
    activationState: contract.activation.active_state,
    externalMode: contract.activation.active_mode,
    attestationTupleSha256: '',
    invocation,
    contract,
  }), contract.activation.active_mode)

  expectHold('trusted_elevated_authorization_unavailable', () => verifyActivationGate({
    activationState: contract.activation.pending_state,
    externalMode: contract.activation.pending_modes[1],
    attestationTupleSha256: pendingDigests[0],
    invocation: pendingInvocations[0],
    contract,
  }))
  expectHold('trusted_elevated_authorization_unavailable', () => verifyActivationGate({
    activationState: contract.activation.active_state,
    externalMode: contract.activation.active_mode,
    attestationTupleSha256: activationTupleSha256(invocation, contract),
    invocation,
    contract,
  }))
  expectHold('trusted_elevated_authorization_unavailable', () => verifyActivationGate({
    activationState: 'unknown',
    externalMode: 'active',
    attestationTupleSha256: '',
    invocation,
    contract,
  }))
})

test('dispatch rejects extra fields, mutable base, reruns, weak nonce, and stale expiry', () => {
  expectHold('invalid_args_format', () => prepareInvocation({ ...rawInput(), extra: true }, context(), contract, NOW))
  expectHold('stale_base', () => prepareInvocation(rawInput(), { ...context(), sha: HEAD }, contract, NOW))
  expectHold('wrong_checkout', () => prepareInvocation(rawInput(), { ...context(), runAttempt: '2' }, contract, NOW))
  expectHold('invalid_args_format', () => prepareInvocation({ ...rawInput(), nonce: 'short' }, context(), contract, NOW))
  expectHold('invalid_args_format', () => prepareInvocation({
    ...rawInput(), expectedActivationMode: 'attesting_unknown',
  }, context(), contract, NOW))
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

test('NUL numstat rejects binary candidates before arbiter evidence is built', () => {
  const text = parseNumstatZ(`12\t3\tscripts/text.mjs\0`)
  assert.deepEqual(text, [{ added: '12', deleted: '3', path: 'scripts/text.mjs', binary: false }])
  rejectBinaryDiff(text)

  const binary = parseNumstatZ(`-\t-\tscripts/payload.bin\0`)
  assert.deepEqual(binary, [{ added: '-', deleted: '-', path: 'scripts/payload.bin', binary: true }])
  expectHold('scope_drift', () => rejectBinaryDiff(binary))
  expectHold('scope_drift', () => parseNumstatZ(`-\t0\tscripts/malformed.bin\0`))
  expectHold('scope_drift', () => parseNumstatZ(`1\t0\t../escape\0`))
})

test('raw git modes reject gitlinks and other opaque candidate objects', () => {
  const zero = '0'.repeat(40)
  const oid = 'a'.repeat(40)
  const regular = parseRawDiffZ(`:000000 100644 ${zero} ${oid} A\0scripts/text.mjs\0`)
  assert.deepEqual(regular, [{
    oldMode: '000000', newMode: '100644', status: 'A', path: 'scripts/text.mjs',
  }])
  rejectOpaqueGitModes(regular)
  for (const mode of ['120000', '160000']) {
    const opaque = parseRawDiffZ(`:000000 ${mode} ${zero} ${oid} A\0scripts/opaque\0`)
    expectHold('scope_drift', () => rejectOpaqueGitModes(opaque))
  }
  expectHold('scope_drift', () => parseRawDiffZ(`:000000 100644 ${zero} ${oid} A\0../escape\0`))
})

test('Linux git raw output exposes a real gitlink to the opaque-mode guard', {
  skip: process.platform !== 'linux',
}, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'trusted-merge-gitlink-'))
  const git = (...args) => {
    const result = spawnSync('/usr/bin/git', args, { cwd: fixture, encoding: 'buffer' })
    assert.equal(result.status, 0, result.stderr?.toString('utf8'))
    return result.stdout
  }
  try {
    git('init', '--quiet')
    git('config', 'user.email', 'trusted-host@example.invalid')
    git('config', 'user.name', 'Trusted Host Test')
    await mkdir(join(fixture, 'scripts'))
    await writeFile(join(fixture, 'scripts', 'base.txt'), 'base\n')
    git('add', 'scripts/base.txt')
    git('commit', '--quiet', '-m', 'base')
    const commit = git('rev-parse', 'HEAD').toString('utf8').trim()
    git('update-index', '--add', '--cacheinfo', `160000,${commit},scripts/opaque-dependency`)
    const raw = git('diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', 'HEAD')
    expectHold('scope_drift', () => rejectOpaqueGitModes(parseRawDiffZ(raw)))
  } finally {
    await rm(fixture, { recursive: true, force: true })
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
  for (const actors of [{}, 'none', 0, false]) {
    expectHold('branch_protection_single_owner_gate_not_strict', () => {
      const unsafe = protection()
      unsafe.required_pull_request_reviews.bypass_pull_request_allowances.apps = actors
      verifyBranchProtection(unsafe, checkSources)
    })
  }
  for (const missing of ['users', 'teams', 'apps']) {
    expectHold('branch_protection_single_owner_gate_not_strict', () => {
      const unsafe = protection()
      delete unsafe.required_pull_request_reviews.bypass_pull_request_allowances[missing]
      verifyBranchProtection(unsafe, checkSources)
    })
    expectHold('branch_protection_single_owner_gate_not_strict', () => {
      const unsafe = protection()
      unsafe.required_pull_request_reviews.bypass_pull_request_allowances[missing] = null
      verifyBranchProtection(unsafe, checkSources)
    })
  }
  expectHold('branch_protection_single_owner_gate_not_strict', () => {
    const unsafe = protection()
    unsafe.required_pull_request_reviews.bypass_pull_request_allowances = null
    verifyBranchProtection(unsafe, checkSources)
  })
  expectHold('branch_protection_single_owner_gate_not_strict', () => {
    const unsafe = protection()
    unsafe.required_pull_request_reviews.bypass_pull_request_allowances.future_actors = [{ id: 1 }]
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

  const stablePr = bindVerifiedPullRequestIdentity(pr(invocation))
  const volatile = pr(invocation)
  volatile.mergeCommit = 'c'.repeat(40)
  assert.deepEqual(bindVerifiedPullRequestIdentity(volatile), stablePr)
  const bodyChanged = pr(invocation)
  bodyChanged.body = 'Changed pull request body'
  assert.notDeepEqual(bindVerifiedPullRequestIdentity(bodyChanged), stablePr)
  expectHold('review_required', () => verifyPullRequestIdentity({ ...pr(invocation), reviewDecision: 'REVIEW_REQUIRED' }, invocation, { final: true }))
  expectHold('final_gate_not_clean', () => verifyPullRequestIdentity({ ...pr(invocation), mergeStateStatus: 'BLOCKED' }, invocation, { final: true }))
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

  const leakedMarkers = [
    'synthetic-aws-value',
    'synthetic-client-value',
    'synthetic-database-password',
    'synthetic-structured-key-value',
    'synthetic-camelcase-key-value',
    'synthetic-uri-password',
    'synthetic-nested-token',
    'synthetic-query-token',
    'synthetic-fragment-password',
    'synthetic-powershell-secret',
    'synthetic-sensitive-suffix',
    'synthetic-ampersand-suffix',
    'synthetic-paren-suffix',
    'synthetic-bracket-suffix',
    'synthetic-brace-suffix',
    'synthetic-credential-value',
    'synthetic-credentials-value',
    'synthetic-authorization-value',
    'synthetic-proxy-authorization-value',
    'synthetic-cookie-value',
    'synthetic-request-cookie-value',
    'synthetic-yaml-block-value',
    'synthetic-yaml-folded-value',
    'synthetic-authorization-assignment',
    'synthetic-structured-authorization',
    'synthetic-pretty-json',
    'synthetic-yaml-plain',
    'synthetic-multiline-quote',
    'synthetic-here-string',
    'synthetic-header-continuation',
    'synthetic-added-uri',
    'synthetic-removed-uri',
    'synthetic-semicolon-uri',
    'synthetic-comma-uri',
    'synthetic-paren-uri',
    'synthetic-triple-secret',
    'continued-triple-secret',
    'synthetic-prefixed-triple-secret',
    'continued-prefixed-triple',
    'synthetic-nested-credential',
    'synthetic-array-credential',
    'synthetic-indented-header-token',
  ]
  const safeMarkers = [
    'safe-rotation-days',
    'safe-token-count',
    'safe-password-policy',
    'safe-database-pool-size',
    'safe-docs-url',
    'visible-after-pretty-json',
    'visible-after-yaml-plain',
    'visible-after-multiline-quote',
    'visible-after-here-string',
    'visible-after-header-continuation',
    'visible-security-critical-context',
    'visible-after-triple',
    'visible-after-prefixed-triple',
    'visible-after-nested-credential',
    'visible-after-array-credential',
    'visible-same-indent-security-critical',
    'visible-context-security-critical',
    'visible-opposite-prefix-security-critical',
    'visible-after-blank-security-critical',
  ]
  const evidence = buildBoundedEvidence({
    diff: [
      'token=ghp_abcdefghijklmnopqrstuvwx',
      '+export AWS_SECRET_ACCESS_KEY=synthetic-aws-value',
      '+"client_secret": "synthetic-client-value"',
      '+DATABASE_URL=postgres://user:synthetic-database-password@example.invalid/db',
      '+callback=https://user:synthetic-uri-password@example.invalid/path',
      '+note="token=synthetic-nested-token"',
      '+callback=https://example.invalid/path?token=synthetic-query-token',
      '+fragment=#password=synthetic-fragment-password',
      "+$env:OPENAI_API_KEY='synthetic-powershell-secret'",
      '+password=prefix#synthetic-sensitive-suffix',
      '+password=prefix&synthetic-ampersand-suffix',
      '+password=prefix)synthetic-paren-suffix',
      '+password=prefix]synthetic-bracket-suffix',
      '+password=prefix}synthetic-brace-suffix',
      '+credential=synthetic-credential-value',
      '+credentials=synthetic-credentials-value',
      '+Authorization: Bearer synthetic-authorization-value',
      '+Proxy-Authorization: Basic synthetic-proxy-authorization-value',
      '+Set-Cookie: session=synthetic-cookie-value; Secure',
      '+Cookie: session=synthetic-request-cookie-value',
      '+password: |',
      '+  synthetic-yaml-block-value',
      '+safe_setting: visible-after-yaml-block',
      '+token: >-',
      '+  synthetic-yaml-folded-value',
      '+safe_folded_setting: visible-after-folded-block',
      '+Authorization=Bearer synthetic-authorization-assignment',
      '+"token":',
      '+  "synthetic-pretty-json"',
      '+safe_pretty: visible-after-pretty-json',
      '+password:',
      '+  synthetic-yaml-plain',
      '+safe_plain: visible-after-yaml-plain',
      '+secret: "line-one',
      '+synthetic-multiline-quote"',
      '+safe_quote: visible-after-multiline-quote',
      "+token: @'",
      '+synthetic-here-string',
      "+'@",
      '+safe_here: visible-after-here-string',
      '+Authorization: Bearer prefix',
      '+  synthetic-header-continuation',
      '+safe_header: visible-after-header-continuation',
      '+    Authorization: Bearer synthetic-indented-header-token',
      '+    if (visible-security-critical-context) bypassChecks();',
      '+password = """synthetic-triple-secret',
      '+continued-triple-secret"""',
      '+safe_triple: visible-after-triple',
      "+token = rf'''synthetic-prefixed-triple-secret",
      "+continued-prefixed-triple'''",
      '+safe_prefixed_triple: visible-after-prefixed-triple',
      '+credentials: {',
      '+  "value": "synthetic-nested-credential",',
      '+  "nested": ["brace } inside string", {"value": "nested"}]',
      '+}',
      '+safe_nested_setting: visible-after-nested-credential',
      '+credentials: ["synthetic-array-credential", {"value": "] inside string"}]',
      '+safe_array_setting: visible-after-array-credential',
      '+token:',
      '+if (visible-same-indent-security-critical) bypassChecks();',
      '+password:',
      '+',
      '+if (visible-after-blank-security-critical) bypassChecks();',
      '+secret:',
      ' context visible-context-security-critical',
      '+safe_after_context();',
      '+api_key:',
      '-removed visible-opposite-prefix-security-critical',
      '+safe_after_opposite_prefix();',
      '+https://user:synthetic-added-uri@added.example.invalid/path',
      '-redis://user:synthetic-removed-uri@removed.example.invalid/db',
      '+https://user:pre;synthetic-semicolon-uri@semi.example.invalid/path',
      '+https://user:pre,synthetic-comma-uri@comma.example.invalid/path',
      '+https://user:pre)synthetic-paren-uri@paren.example.invalid/path',
      '+SECRET_ROTATION_DAYS=safe-rotation-days',
      '+TOKEN_COUNT=safe-token-count',
      '+PASSWORD_POLICY=safe-password-policy',
      '+DATABASE_URL_POOL_SIZE=safe-database-pool-size',
      '+DOCS_URL=https://example.invalid/safe-docs-url',
    ].join('\n'),
    structured: {
      OPENAI_API_KEY: 'synthetic-structured-key-value',
      openaiApiKey: 'synthetic-camelcase-key-value',
      Authorization: 'Bearer synthetic-structured-authorization',
    },
  }, 500000)
  assert.ok(evidence.serialized.includes('[REDACTED]'))
  assert.ok(!evidence.serialized.includes('ghp_'))
  for (const marker of leakedMarkers) assert.ok(!evidence.serialized.includes(marker), marker)
  for (const marker of safeMarkers) assert.ok(evidence.serialized.includes(marker), marker)
  expectHold('evidence_too_large_for_arbiter', () => buildBoundedEvidence({ diff: 'x'.repeat(100) }, 20))

  const longNonSecretAssignment = `${'a'.repeat(499000)}=x`
  const redactionStartedAt = performance.now()
  assert.equal(sanitizeUntrustedText(longNonSecretAssignment), longNonSecretAssignment)
  const redactionMilliseconds = performance.now() - redactionStartedAt
  assert.ok(redactionMilliseconds < 2000, `499KB redaction took ${redactionMilliseconds}ms`)

  const unterminatedBackslashes = `safeKey="${'\\'.repeat(50_000)}`
  const backslashStartedAt = performance.now()
  assert.equal(sanitizeUntrustedText(unterminatedBackslashes), unterminatedBackslashes)
  const backslashMilliseconds = performance.now() - backslashStartedAt
  assert.ok(backslashMilliseconds < 1000, `unterminated quote redaction took ${backslashMilliseconds}ms`)

  const manyDelimiters = 'safe_key=value&'.repeat(32_000)
  const delimiterStartedAt = performance.now()
  assert.equal(sanitizeUntrustedText(manyDelimiters), manyDelimiters)
  const delimiterMilliseconds = performance.now() - delimiterStartedAt
  assert.ok(delimiterMilliseconds < 2000, `many-delimiter redaction took ${delimiterMilliseconds}ms`)

  const credentialUris = sanitizeUntrustedText([
    'redis://:synthetic-empty-user-password@redis.example.invalid/db',
    'https://synthetic-token-userinfo@api.example.invalid/v1',
  ].join(' '))
  assert.ok(!credentialUris.includes('synthetic-empty-user-password'))
  assert.ok(!credentialUris.includes('synthetic-token-userinfo'))
  assert.ok(credentialUris.includes('redis.example.invalid/db'))
  assert.ok(credentialUris.includes('api.example.invalid/v1'))
  assert.ok(evidence.serialized.includes('added.example.invalid/path'))
  assert.ok(evidence.serialized.includes('removed.example.invalid/db'))
  assert.ok(evidence.serialized.includes('semi.example.invalid/path'))
  assert.ok(evidence.serialized.includes('comma.example.invalid/path'))
  assert.ok(evidence.serialized.includes('paren.example.invalid/path'))
  assert.ok(evidence.serialized.includes('visible-after-yaml-block'))
  assert.ok(evidence.serialized.includes('visible-after-folded-block'))
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
  assert.equal(mergeOutcomeUnverifiedResult(invocation, 'unreadable').merged, null)
  assert.equal(mergedResult(invocation, 'c'.repeat(40)).status, 'merged')
  assert.equal(mergedResult(invocation, 'c'.repeat(40), 'fetch_failed').status, 'merged_but_closeout_held')
})
