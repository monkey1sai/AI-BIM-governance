import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  TrustedMergeHold,
  activationTupleSha256,
  apexVerdictSchema,
  buildBrokerAssertion,
  canonicalHumanApprovalBody,
  prepareInvocation,
} from '../lib/trusted-host-merge.mjs'
import {
  executeTrustedMerge,
  verifyExecutionTimingBudget,
  verifyTrustedOriginUrl,
} from '../lib/trusted-host-merge-executor.mjs'
import {
  GitHubApi,
  invokeClaudeApex,
  invokeCodexApex,
  mintInstallationToken,
} from '../lib/trusted-host-merge-runtime.mjs'


const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const contract = JSON.parse(await readFile(join(repoRoot, 'agent-contracts/trusted-host-merge.contract.json'), 'utf8'))
const verdictSchema = JSON.parse(await readFile(join(repoRoot, 'agent-contracts/trusted-host-merge-verdict.schema.json'), 'utf8'))
const workflow = await readFile(join(repoRoot, '.github/workflows/trusted-elevated-merge.yml'), 'utf8')
const cliSource = await readFile(join(repoRoot, 'scripts/dev/trusted-host-merge.mjs'), 'utf8')
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const NOW = new Date('2026-08-12T02:00:00.000Z')
const EXPIRES = '2026-08-12T02:10:00.000Z'

const invocation = prepareInvocation({
  prNumber: '42', expectedHead: HEAD, expectedBase: BASE,
  expectedActivationMode: 'active',
  provider: 'codex', nonce: 'n'.repeat(32), expiresAt: EXPIRES,
}, {
  eventName: 'workflow_dispatch', repository: contract.repository.full_name,
  ref: 'refs/heads/main', sha: BASE, runId: '987654', runAttempt: '1',
}, contract, NOW)
const activeActivation = () => ({
  activationState: contract.activation.active_state,
  externalMode: contract.activation.active_mode,
  attestationTupleSha256: '',
})

const executeWithStableGates = ({
  api,
  sleep = async () => {},
  contractOverride = contract,
  closeoutFetcher = () => {},
}) => {
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(invocation), commitId: HEAD,
  }
  const snapshot = {
    immutable: { stable: true }, immutableSha256: 'c'.repeat(64), approval,
    reviewSurface: { normalized: {}, sha256: 'd'.repeat(64) },
  }
  return executeTrustedMerge({
    api,
    invocation,
    assertion: buildBrokerAssertion(invocation, contract),
    contract: contractOverride,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep,
    snapshotCollector: async () => structuredClone(snapshot),
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => ({
      allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
      approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
      approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
    }),
    closeoutFetcher,
    activation: activeActivation(),
  })
}

test('runtime verdict grammar is identical to the tracked machine schema', () => {
  const { $schema: _schema, $id: _id, ...tracked } = verdictSchema
  assert.deepEqual(apexVerdictSchema, tracked)
})

test('installation token is RSA-signed and narrowed to one repository and fixed capabilities', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
  let request
  const minted = await mintInstallationToken({
    appId: '123',
    installationId: '456',
    privateKey: pem,
    repository: contract.repository.full_name,
    permissions: contract.executor.github_app_token.permissions,
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.app_token_mint_milliseconds,
    now: NOW,
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) }
      return new Response(JSON.stringify({
        token: `ghs_${'x'.repeat(40)}`,
        expires_at: '2026-08-12T03:00:00.000Z',
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    },
  })
  assert.equal(minted.expiresAt, '2026-08-12T03:00:00.000Z')
  assert.match(request.init.headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/u)
  assert.deepEqual(request.body, {
    repositories: ['AI-BIM-governance'],
    permissions: contract.executor.github_app_token.permissions,
  })
  assert.ok(!request.init.body.includes('PRIVATE KEY'))
  assert.ok(request.init.signal instanceof AbortSignal)

  await assert.rejects(() => mintInstallationToken({
    apiBaseUrl: 'https://attacker.invalid',
    appId: '123', installationId: '456', privateKey: pem,
    repository: contract.repository.full_name,
    permissions: contract.executor.github_app_token.permissions,
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.app_token_mint_milliseconds,
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'github_api_origin_invalid')

  await assert.rejects(() => mintInstallationToken({
    appId: '123', installationId: '456', privateKey: pem,
    repository: contract.repository.full_name,
    permissions: contract.executor.github_app_token.permissions,
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.app_token_mint_milliseconds,
    fetchImpl: async () => { throw new Error('simulated stalled mint') },
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'github_app_token_mint_request_failed')
})

test('GitHub client paginates only same-origin JSON and never places token in URLs', async () => {
  const seen = []
  const api = new GitHubApi({
    token: `ghs_${'x'.repeat(40)}`,
    fetchImpl: async (url, init) => {
      seen.push({ url, auth: init.headers.Authorization })
      if (url.endsWith('/items?page=1')) {
        return new Response('[{"id":1}]', {
          status: 200,
          headers: { link: '<https://api.github.com/items?page=2>; rel="next"' },
        })
      }
      return new Response('[{"id":2}]', { status: 200 })
    },
  })
  assert.deepEqual(await api.paginate('/items?page=1', {
    signal: AbortSignal.timeout(contract.executor.pre_sink_timeouts.snapshot_milliseconds),
  }), [{ id: 1 }, { id: 2 }])
  assert.equal(seen.length, 2)
  assert.ok(seen.every((item) => !item.url.includes('ghs_') && item.auth.startsWith('Bearer ghs_')))

  const hostile = new GitHubApi({
    token: `ghs_${'x'.repeat(40)}`,
    fetchImpl: async () => new Response('[]', {
      status: 200,
      headers: { link: '<https://attacker.invalid/steal>; rel="next"' },
    }),
  })
  await assert.rejects(() => hostile.paginate('/items'), (error) => (
    error instanceof TrustedMergeHold && error.detail === 'pagination_origin_mismatch'
  ))

  let timeoutSignal
  const timed = new GitHubApi({
    token: `ghs_${'x'.repeat(40)}`,
    fetchImpl: async (_url, init) => {
      timeoutSignal = init.signal
      return new Response('{}', { status: 200 })
    },
  })
  await timed.request('/bounded', { timeoutMilliseconds: 3000 })
  assert.ok(timeoutSignal instanceof AbortSignal)
  await assert.rejects(() => timed.request('/invalid', { timeoutMilliseconds: 0 }), (error) => (
    error instanceof TrustedMergeHold && error.detail === 'github_request_timeout_invalid'
  ))
  const stalled = new GitHubApi({
    token: `ghs_${'x'.repeat(40)}`,
    fetchImpl: async () => { throw new Error('simulated stalled read') },
  })
  await assert.rejects(() => stalled.request('/stalled', {
    timeoutMilliseconds: 30000,
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'github_api_request_failed')
})

test('Claude and Codex apex calls expose no tools and accept one schema-bound object', async () => {
  const verdict = {
    allowMerge: false,
    prNumber: 42,
    headOid: HEAD,
    baseOid: BASE,
    approvalReviewId: 1,
    approvalReviewNodeId: 'node',
    approvalBody: 'body',
    approvalCommitId: HEAD,
    heldReason: 'ship_blocked',
    evidence: ['blocked'],
  }
  let codexBody
  let codexSignal
  const codex = await invokeCodexApex({
    apiKey: `sk-${'x'.repeat(40)}`,
    model: 'gpt-5.6-sol',
    evidence: '{"untrusted":true}',
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.apex_request_milliseconds,
    fetchImpl: async (_url, init) => {
      codexBody = JSON.parse(init.body)
      codexSignal = init.signal
      return new Response(JSON.stringify({
        status: 'completed',
        output: [
          { type: 'reasoning', summary: [] },
          {
            type: 'message', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: JSON.stringify(verdict) }],
          },
        ],
      }), { status: 200 })
    },
  })
  assert.deepEqual(codex, verdict)
  assert.deepEqual(codexBody.tools, [])
  assert.ok(codexSignal instanceof AbortSignal)
  assert.equal(codexBody.reasoning.effort, 'xhigh')
  assert.equal(codexBody.text.format.strict, true)

  let claudeBody
  let claudeSignal
  const claude = await invokeClaudeApex({
    apiKey: `anthropic-${'x'.repeat(40)}`,
    model: 'claude-fable-5',
    evidence: '{"untrusted":true}',
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.apex_request_milliseconds,
    fetchImpl: async (_url, init) => {
      claudeBody = JSON.parse(init.body)
      claudeSignal = init.signal
      return new Response(JSON.stringify({
        type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(verdict) }],
      }), { status: 200 })
    },
  })
  assert.deepEqual(claude, verdict)
  assert.deepEqual(claudeBody.tools, [])
  assert.ok(claudeSignal instanceof AbortSignal)
  assert.equal(claudeBody.output_config.effort, 'max')

  await assert.rejects(() => invokeCodexApex({
    apiKey: `sk-${'x'.repeat(40)}`,
    model: 'gpt-5.6-sol',
    evidence: '{}',
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.apex_request_milliseconds,
    fetchImpl: async () => { throw new Error('simulated stalled apex') },
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'codex_apex_request_failed')
})

test('provider routing never falls through to the other provider secret', () => {
  assert.match(workflow, /if: \$\{\{ inputs\.apex_provider == 'claude' \}\}[\s\S]*?TRUSTED_MERGE_APEX_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/u)
  assert.match(workflow, /if: \$\{\{ inputs\.apex_provider == 'codex' \}\}[\s\S]*?TRUSTED_MERGE_APEX_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/u)
  assert.doesNotMatch(workflow, /&&\s*secrets\.|\|\|\s*secrets\./u)
  assert.equal((workflow.match(/TRUSTED_MERGE_ACTIVATION_MODE: \$\{\{ vars\.TRUSTED_MERGE_ACTIVATION_MODE \}\}/gu) || []).length, 3)
  assert.equal((workflow.match(/TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256: \$\{\{ vars\.TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256 \}\}/gu) || []).length, 3)
  assert.equal((workflow.match(/INPUT_EXPECTED_ACTIVATION_MODE: \$\{\{ inputs\.expected_activation_mode \}\}/gu) || []).length, 4)
  assert.ok(workflow.indexOf('node scripts/dev/trusted-host-merge.mjs activate') < workflow.indexOf('TRUSTED_MERGE_APP_PRIVATE_KEY:'))
  assert.ok(cliSource.indexOf('verifyActivationGate(activation)') < cliSource.indexOf('mintInstallationToken({'))
  assert.match(cliSource, /activationStateContract\.ship\.activation_state/u)
})

test('trusted origin accepts only the two exact actions/checkout HTTPS spellings', () => {
  assert.doesNotThrow(() => verifyTrustedOriginUrl(
    `https://github.com/${invocation.repo}`,
    invocation,
  ))
  assert.doesNotThrow(() => verifyTrustedOriginUrl(
    `https://github.com/${invocation.repo}.git`,
    invocation,
  ))
  for (const hostile of [
    `git@github.com:${invocation.repo}.git`,
    `https://github.com/${invocation.repo}.git/extra`,
    `https://github.com/${invocation.repo}.evil.invalid`,
    `https://github.com/${invocation.repo.toLowerCase()}`,
  ]) {
    assert.throws(
      () => verifyTrustedOriginUrl(hostile, invocation),
      (error) => error instanceof TrustedMergeHold && error.detail === 'origin_url_mismatch',
    )
  }
})

test('apex adapters reject mixed, truncated, or ambiguous provider output', async () => {
  const apiKey = `sk-${'x'.repeat(40)}`
  const codexResponse = (content) => new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', status: 'completed', role: 'assistant', content }],
  }), { status: 200 })
  await assert.rejects(() => invokeCodexApex({
    apiKey,
    model: 'gpt-5.6-sol',
    evidence: '{}',
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.apex_request_milliseconds,
    fetchImpl: async () => codexResponse([
      { type: 'output_text', text: '{}' },
      { type: 'refusal', refusal: 'no' },
    ]),
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'codex_apex_request_failed')

  await assert.rejects(() => invokeClaudeApex({
    apiKey: `anthropic-${'x'.repeat(40)}`,
    model: 'claude-fable-5',
    evidence: '{}',
    timeoutMilliseconds: contract.executor.pre_sink_timeouts.apex_request_milliseconds,
    fetchImpl: async () => new Response(JSON.stringify({
      type: 'message', role: 'assistant', stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{}' }],
    }), { status: 200 }),
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'claude_apex_request_failed')
})

test('executor rechecks five immutable snapshots and invokes the exact-head merge once', async () => {
  const approval = {
    id: 77,
    nodeId: 'PRR_node',
    body: canonicalHumanApprovalBody(invocation),
    commitId: HEAD,
  }
  const stable = {
    immutable: { identity: 'stable' },
    immutableSha256: 'f'.repeat(64),
    approval,
    reviewSurface: { normalized: { pullComments: [], reviews: [], issueComments: [] }, sha256: 'e'.repeat(64) },
  }
  let snapshots = 0
  let mergeCalls = 0
  let closeouts = 0
  let sleepCalls = 0
  const api = {
    request: async (path, options = {}) => {
      if (options.method === 'PUT') {
        mergeCalls += 1
        assert.equal(path, `/repos/${invocation.repo}/pulls/42/merge`)
        assert.deepEqual(options.body, { sha: HEAD, merge_method: 'merge' })
        assert.equal(options.timeoutMilliseconds, contract.executor.merge_request_timeout_milliseconds)
        return { value: { merged: true, sha: 'c'.repeat(40) } }
      }
      return { value: {
        number: 42, state: 'closed', merged: true, merge_commit_sha: 'c'.repeat(40),
        head: { sha: HEAD, repo: { full_name: invocation.repo } },
        base: { ref: 'main', repo: { full_name: invocation.repo } },
      } }
    },
  }
  const result = await executeTrustedMerge({
    api,
    invocation,
    assertion: buildBrokerAssertion(invocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async (milliseconds) => { sleepCalls += 1; assert.equal(milliseconds, 30000) },
    snapshotCollector: async () => { snapshots += 1; return structuredClone(stable) },
    gitEvidenceCollector: () => ({
      entries: [{ status: 'M', path: '.github/workflows/ci.yml' }],
      paths: ['.github/workflows/ci.yml'], diff: 'diff', stat: 'stat', log: 'log',
    }),
    apexInvoker: async () => ({
      allowMerge: true,
      prNumber: invocation.prNumber,
      headOid: invocation.headOid,
      baseOid: invocation.baseOid,
      approvalReviewId: approval.id,
      approvalReviewNodeId: approval.nodeId,
      approvalBody: approval.body,
      approvalCommitId: approval.commitId,
      heldReason: null,
      evidence: ['All immutable gates agree.'],
    }),
    closeoutFetcher: (options) => {
      closeouts += 1
      assert.equal(options.timeoutMilliseconds, contract.executor.closeout_fetch_timeout_milliseconds)
    },
    activation: activeActivation(),
  })
  assert.equal(result.status, 'merged')
  assert.equal(result.mergeCommit, 'c'.repeat(40))
  assert.equal(snapshots, 5)
  assert.equal(sleepCalls, 3)
  assert.equal(mergeCalls, 1)
  assert.equal(closeouts, 1)
})

test('pull request body drift after the verdict blocks before the irreversible sink', async () => {
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(invocation), commitId: HEAD,
  }
  let snapshots = 0
  let mergeCalls = 0
  await assert.rejects(() => executeTrustedMerge({
    api: { request: async () => { mergeCalls += 1; return { value: {} } } },
    invocation,
    assertion: buildBrokerAssertion(invocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async () => {},
    snapshotCollector: async () => {
      snapshots += 1
      const body = snapshots === 5 ? 'Changed pull request body' : 'Original pull request body'
      return {
        immutable: { pullRequest: { body } },
        immutableSha256: snapshots === 5 ? '1'.repeat(64) : '2'.repeat(64),
        approval,
        reviewSurface: { normalized: {}, sha256: '3'.repeat(64) },
      }
    },
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => ({
      allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
      approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
      approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
    }),
    activation: activeActivation(),
  }), (error) => error instanceof TrustedMergeHold && error.reason === 'identity_changed_after_verdict')
  assert.equal(snapshots, 5)
  assert.equal(mergeCalls, 0)
})

test('successful merge response without an exact authoritative reread remains unknown', async () => {
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(invocation), commitId: HEAD,
  }
  const snapshot = {
    immutable: { stable: true }, immutableSha256: '4'.repeat(64), approval,
    reviewSurface: { normalized: {}, sha256: '5'.repeat(64) },
  }
  let mergeCalls = 0
  const result = await executeTrustedMerge({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') {
          mergeCalls += 1
          return { value: { merged: true, sha: 'c'.repeat(40) } }
        }
        return { value: {
          number: 42, state: 'open', merged: false, merge_commit_sha: null,
          head: { sha: HEAD, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
      },
    },
    invocation,
    assertion: buildBrokerAssertion(invocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async () => {},
    snapshotCollector: async () => structuredClone(snapshot),
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => ({
      allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
      approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
      approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
    }),
    activation: activeActivation(),
  })
  assert.equal(mergeCalls, 1)
  assert.equal(result.merged, null)
  assert.equal(result.status, 'merge_outcome_unverified')
  assert.equal(result.mergeCommit, null)
  assert.equal(result.heldDetail, 'post_merge_state_not_yet_consistent')
})

test('ambiguous merge response is never retried and bounded polling can observe eventual success', async () => {
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(invocation), commitId: HEAD,
  }
  const snapshot = {
    immutable: { stable: true }, immutableSha256: '6'.repeat(64), approval,
    reviewSurface: { normalized: {}, sha256: '7'.repeat(64) },
  }
  let mergeCalls = 0
  let reads = 0
  const sleeps = []
  const result = await executeTrustedMerge({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') {
          mergeCalls += 1
          throw new Error('connection reset after request write')
        }
        reads += 1
        if (reads < 3) return { value: {
          number: 42, state: 'open', merged: false, merge_commit_sha: null,
          head: { sha: HEAD, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
        return { value: {
          number: 42, state: 'closed', merged: true, merge_commit_sha: 'd'.repeat(40),
          head: { sha: HEAD, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
      },
    },
    invocation,
    assertion: buildBrokerAssertion(invocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async (milliseconds) => { sleeps.push(milliseconds) },
    snapshotCollector: async () => structuredClone(snapshot),
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => ({
      allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
      approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
      approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
    }),
    closeoutFetcher: () => {},
    activation: activeActivation(),
  })
  assert.equal(result.status, 'merged')
  assert.equal(result.mergeCommit, 'd'.repeat(40))
  assert.equal(mergeCalls, 1)
  assert.equal(reads, 3)
  assert.deepEqual(sleeps, [30000, 30000, 30000, 1000, 1000])
})

test('ambiguous merge polling reports unknown after bounded unreadable or wrong-identity state', async () => {
  let mergeCalls = 0
  let reads = 0
  let result = await executeWithStableGates({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') mergeCalls += 1
        else reads += 1
        throw new Error('unreadable')
      },
    },
  })
  assert.equal(result.status, 'merge_outcome_unverified')
  assert.equal(result.merged, null)
  assert.equal(result.heldDetail, 'merge_state_unreadable')
  assert.equal(mergeCalls, 1)
  assert.equal(reads, contract.executor.post_merge_observation.attempts)

  mergeCalls = 0
  reads = 0
  result = await executeWithStableGates({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') {
          mergeCalls += 1
          throw new Error('ambiguous merge response')
        }
        reads += 1
        return { value: {
          number: 42, state: 'closed', merged: true, merge_commit_sha: 'e'.repeat(40),
          head: { sha: BASE, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
      },
    },
  })
  assert.equal(result.status, 'merge_outcome_unverified')
  assert.equal(result.merged, null)
  assert.equal(result.heldDetail, 'authoritative_merge_identity_mismatch')
  assert.equal(mergeCalls, 1)
  assert.equal(reads, 1)
})

test('conflicting response and authoritative merge SHAs preserve merged truth but hold closeout', async () => {
  let mergeCalls = 0
  let closeouts = 0
  const result = await executeWithStableGates({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') {
          mergeCalls += 1
          return { value: { merged: true, sha: 'c'.repeat(40) } }
        }
        return { value: {
          number: 42, state: 'closed', merged: true, merge_commit_sha: 'd'.repeat(40),
          head: { sha: HEAD, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
      },
    },
    closeoutFetcher: () => { closeouts += 1 },
  })
  assert.equal(result.status, 'merged_but_closeout_held')
  assert.equal(result.merged, true)
  assert.equal(result.mergeCommit, 'd'.repeat(40))
  assert.equal(result.heldDetail, 'merge_response_sha_mismatch')
  assert.equal(mergeCalls, 1)
  assert.equal(closeouts, 0)
})

test('post-merge closeout failure is bounded and cannot erase authoritative merged truth', async () => {
  let closeouts = 0
  const result = await executeWithStableGates({
    api: {
      request: async (_path, options = {}) => {
        if (options.method === 'PUT') return { value: { merged: true, sha: 'c'.repeat(40) } }
        return { value: {
          number: 42, state: 'closed', merged: true, merge_commit_sha: 'c'.repeat(40),
          head: { sha: HEAD, repo: { full_name: invocation.repo } },
          base: { ref: 'main', repo: { full_name: invocation.repo } },
        } }
      },
    },
    closeoutFetcher: (options) => {
      closeouts += 1
      assert.equal(options.timeoutMilliseconds, contract.executor.closeout_fetch_timeout_milliseconds)
      throw new Error('simulated bounded fetch timeout')
    },
  })
  assert.equal(result.status, 'merged_but_closeout_held')
  assert.equal(result.merged, true)
  assert.equal(result.mergeCommit, 'c'.repeat(40))
  assert.equal(result.heldDetail, 'closeout_fetch_failed')
  assert.equal(closeouts, 1)
})

test('machine timing budget bounds the only merge request and authoritative observation', async () => {
  assert.deepEqual(verifyExecutionTimingBudget(contract), {
    sinkWorstCaseMilliseconds: 25000,
    totalEnvelopeMilliseconds: 1125000,
  })
  const unsafe = structuredClone(contract)
  unsafe.executor.merge_request_timeout_milliseconds = 30000
  unsafe.executor.post_merge_observation.request_timeout_milliseconds = 10000
  let apiCalls = 0
  await assert.rejects(() => executeWithStableGates({
    contractOverride: unsafe,
    api: { request: async () => { apiCalls += 1; return { value: {} } } },
  }), (error) => (
    error instanceof TrustedMergeHold && error.detail === 'irreversible_sink_timing_budget_invalid'
  ))
  assert.equal(apiCalls, 0)

  const overJob = structuredClone(contract)
  overJob.executor.pre_sink_timeouts.workflow_job_milliseconds = 1000000
  await assert.rejects(() => executeWithStableGates({
    contractOverride: overJob,
    api: { request: async () => { apiCalls += 1; return { value: {} } } },
  }), (error) => (
    error instanceof TrustedMergeHold && error.detail === 'workflow_job_timing_budget_invalid'
  ))
})

test('broker expiry margin blocks before the only merge sink', async () => {
  const nearExpiryInvocation = { ...invocation, expiresAt: '2026-08-12T02:00:30.000Z' }
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(nearExpiryInvocation), commitId: HEAD,
  }
  const snapshot = {
    immutable: { stable: true }, immutableSha256: '8'.repeat(64), approval,
    reviewSurface: { normalized: {}, sha256: '9'.repeat(64) },
  }
  let mergeCalls = 0
  await assert.rejects(() => executeTrustedMerge({
    api: { request: async () => { mergeCalls += 1; return { value: {} } } },
    invocation: nearExpiryInvocation,
    assertion: buildBrokerAssertion(nearExpiryInvocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async () => {},
    snapshotCollector: async () => structuredClone(snapshot),
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => ({
      allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
      approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
      approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
    }),
    activation: activeActivation(),
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'authorization_near_expiry')
  assert.equal(mergeCalls, 0)
})

test('negative attestation runs every reversible gate but cannot reach the merge sink', async () => {
  const negativeInvocation = {
    ...invocation,
    activationMode: contract.activation.pending_modes[0],
  }
  const approval = {
    id: 77, nodeId: 'node', body: canonicalHumanApprovalBody(negativeInvocation), commitId: HEAD,
  }
  const snapshot = {
    immutable: { stable: true }, immutableSha256: 'a'.repeat(64), approval,
    reviewSurface: { normalized: {}, sha256: 'b'.repeat(64) },
  }
  let snapshots = 0
  let apexCalls = 0
  let mergeCalls = 0
  await assert.rejects(() => executeTrustedMerge({
    api: { request: async () => { mergeCalls += 1; return { value: {} } } },
    invocation: negativeInvocation,
    assertion: buildBrokerAssertion(negativeInvocation, contract),
    contract,
    repoRoot,
    installationToken: `ghs_${'x'.repeat(40)}`,
    installationTokenExpiresAt: '2026-08-12T03:00:00.000Z',
    apexApiKey: `sk-${'x'.repeat(40)}`,
    apexModel: 'gpt-5.6-sol',
    now: () => NOW,
    sleep: async () => {},
    snapshotCollector: async () => { snapshots += 1; return structuredClone(snapshot) },
    gitEvidenceCollector: () => ({ entries: [], paths: ['scripts/x'], diff: 'd', stat: 's', log: 'l' }),
    apexInvoker: async () => {
      apexCalls += 1
      return {
        allowMerge: true, prNumber: 42, headOid: HEAD, baseOid: BASE,
        approvalReviewId: 77, approvalReviewNodeId: 'node', approvalBody: approval.body,
        approvalCommitId: HEAD, heldReason: null, evidence: ['ok'],
      }
    },
    activation: {
      activationState: contract.activation.pending_state,
      externalMode: contract.activation.pending_modes[0],
      attestationTupleSha256: activationTupleSha256(negativeInvocation, contract),
    },
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'negative_attestation_merge_forbidden')
  assert.equal(snapshots, 5)
  assert.equal(apexCalls, 1)
  assert.equal(mergeCalls, 0)
})

test('challenge CLI writes only the exact tuple to runner-owned files', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'trusted-merge-challenge-'))
  try {
    const output = join(fixture, 'output.txt')
    const summary = join(fixture, 'summary.md')
    const child = spawnSync(process.execPath, ['scripts/dev/trusted-host-merge.mjs', 'challenge'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: fixture,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REPOSITORY: contract.repository.full_name,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_SHA: BASE,
        GITHUB_RUN_ID: '987654',
        GITHUB_RUN_ATTEMPT: '1',
        INPUT_PR_NUMBER: '42',
        INPUT_EXPECTED_HEAD: HEAD,
        INPUT_EXPECTED_BASE: BASE,
        INPUT_EXPECTED_ACTIVATION_MODE: 'attesting_negative',
        INPUT_APEX_PROVIDER: 'claude',
        INPUT_NONCE: 'z'.repeat(32),
        INPUT_EXPIRES_AT: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    })
    assert.equal(child.status, 0, child.stderr)
    assert.match(await readFile(output, 'utf8'), /^provider=claude\r?\nassertion=\{"kind":"ai-bim-trusted-elevated-merge"/u)
    assert.match(await readFile(summary, 'utf8'), /protected-environment approval comment/u)
    assert.ok(!child.stdout.includes('PRIVATE KEY'))
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})
