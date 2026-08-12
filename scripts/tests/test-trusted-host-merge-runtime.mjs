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
  apexVerdictSchema,
  buildBrokerAssertion,
  canonicalHumanApprovalBody,
  prepareInvocation,
} from '../lib/trusted-host-merge.mjs'
import {
  executeTrustedMerge,
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
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const NOW = new Date('2026-08-12T02:00:00.000Z')
const EXPIRES = '2026-08-12T02:10:00.000Z'

const invocation = prepareInvocation({
  prNumber: '42', expectedHead: HEAD, expectedBase: BASE,
  provider: 'codex', nonce: 'n'.repeat(32), expiresAt: EXPIRES,
}, {
  eventName: 'workflow_dispatch', repository: contract.repository.full_name,
  ref: 'refs/heads/main', sha: BASE, runId: '987654', runAttempt: '1',
}, contract, NOW)

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

  await assert.rejects(() => mintInstallationToken({
    apiBaseUrl: 'https://attacker.invalid',
    appId: '123', installationId: '456', privateKey: pem,
    repository: contract.repository.full_name,
    permissions: contract.executor.github_app_token.permissions,
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'github_api_origin_invalid')
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
  assert.deepEqual(await api.paginate('/items?page=1'), [{ id: 1 }, { id: 2 }])
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
  const codex = await invokeCodexApex({
    apiKey: `sk-${'x'.repeat(40)}`,
    model: 'gpt-5.6-sol',
    evidence: '{"untrusted":true}',
    fetchImpl: async (_url, init) => {
      codexBody = JSON.parse(init.body)
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
  assert.equal(codexBody.reasoning.effort, 'xhigh')
  assert.equal(codexBody.text.format.strict, true)

  let claudeBody
  const claude = await invokeClaudeApex({
    apiKey: `anthropic-${'x'.repeat(40)}`,
    model: 'claude-fable-5',
    evidence: '{"untrusted":true}',
    fetchImpl: async (_url, init) => {
      claudeBody = JSON.parse(init.body)
      return new Response(JSON.stringify({
        type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(verdict) }],
      }), { status: 200 })
    },
  })
  assert.deepEqual(claude, verdict)
  assert.deepEqual(claudeBody.tools, [])
  assert.equal(claudeBody.output_config.effort, 'max')
})

test('provider routing never falls through to the other provider secret', () => {
  assert.match(workflow, /if: \$\{\{ inputs\.apex_provider == 'claude' \}\}[\s\S]*?TRUSTED_MERGE_APEX_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/u)
  assert.match(workflow, /if: \$\{\{ inputs\.apex_provider == 'codex' \}\}[\s\S]*?TRUSTED_MERGE_APEX_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/u)
  assert.doesNotMatch(workflow, /&&\s*secrets\.|\|\|\s*secrets\./u)
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
    fetchImpl: async () => codexResponse([
      { type: 'output_text', text: '{}' },
      { type: 'refusal', refusal: 'no' },
    ]),
  }), (error) => error instanceof TrustedMergeHold && error.detail === 'codex_apex_request_failed')

  await assert.rejects(() => invokeClaudeApex({
    apiKey: `anthropic-${'x'.repeat(40)}`,
    model: 'claude-fable-5',
    evidence: '{}',
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
        return { value: { merged: true, sha: 'c'.repeat(40) } }
      }
      return { value: {
        merged: true, merge_commit_sha: 'c'.repeat(40),
        head: { sha: HEAD }, base: { ref: 'main' },
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
    closeoutFetcher: () => { closeouts += 1 },
  })
  assert.equal(result.status, 'merged')
  assert.equal(result.mergeCommit, 'c'.repeat(40))
  assert.equal(snapshots, 5)
  assert.equal(sleepCalls, 3)
  assert.equal(mergeCalls, 1)
  assert.equal(closeouts, 1)
})

test('snapshot drift after the verdict blocks before the irreversible sink', async () => {
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
      return {
        immutable: { sequence: snapshots === 5 ? 'changed' : 'stable' },
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
  }), (error) => error instanceof TrustedMergeHold && error.reason === 'branch_protection_changed_after_verdict')
  assert.equal(snapshots, 5)
  assert.equal(mergeCalls, 0)
})

test('authoritative merge success is never downgraded during post-merge read lag', async () => {
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
          merged: false, merge_commit_sha: null,
          head: { sha: HEAD }, base: { ref: 'main' },
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
  })
  assert.equal(mergeCalls, 1)
  assert.equal(result.merged, true)
  assert.equal(result.status, 'merged_but_closeout_held')
  assert.equal(result.mergeCommit, 'c'.repeat(40))
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
