#!/usr/bin/env node

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TrustedMergeHold,
  buildBrokerAssertion,
  heldResult,
  prepareInvocation,
  sha256,
} from '../lib/trusted-host-merge.mjs'
import { executeTrustedMerge } from '../lib/trusted-host-merge-executor.mjs'
import { GitHubApi, mintInstallationToken } from '../lib/trusted-host-merge-runtime.mjs'


const scriptRepoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const contractPath = resolve(scriptRepoRoot, 'agent-contracts/trusted-host-merge.contract.json')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))

const rawInput = {
  prNumber: process.env.INPUT_PR_NUMBER,
  expectedHead: process.env.INPUT_EXPECTED_HEAD,
  expectedBase: process.env.INPUT_EXPECTED_BASE,
  provider: process.env.INPUT_APEX_PROVIDER,
  nonce: process.env.INPUT_NONCE,
  expiresAt: process.env.INPUT_EXPIRES_AT,
}

const context = {
  eventName: process.env.GITHUB_EVENT_NAME,
  repository: process.env.GITHUB_REPOSITORY,
  ref: process.env.GITHUB_REF,
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT,
}

const appendPlatformFile = async (path, content) => {
  const runnerTemp = resolve(process.env.RUNNER_TEMP || '/nonexistent')
  const relativePath = typeof path === 'string' ? relative(runnerTemp, resolve(path)) : '..'
  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(path) === runnerTemp) {
    throw new TrustedMergeHold('host_env_blocked', 'platform_output_path_invalid')
  }
  await appendFile(path, content, { encoding: 'utf8' })
}

const outputChallenge = async (invocation, assertion) => {
  const summary = [
    '## Trusted elevated merge approval required',
    '',
    'Confirm the PR/head/base/provider/expiry tuple, then paste this exact one-line JSON as the protected-environment approval comment:',
    '',
    '```json',
    assertion,
    '```',
    '',
    `Assertion SHA-256: \`${sha256(assertion)}\``,
    '',
  ].join('\n')
  await appendPlatformFile(process.env.GITHUB_STEP_SUMMARY, summary)
  await appendPlatformFile(process.env.GITHUB_OUTPUT, [
    `provider=${invocation.provider}`,
    `assertion=${assertion}`,
    '',
  ].join('\n'))
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'trusted-host-merge-challenge/v1',
    repo: invocation.repo,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    provider: invocation.provider,
    runId: invocation.runId,
    expiresAt: invocation.expiresAt,
  })}\n`)
}

const writeResult = async (result) => {
  const runnerTemp = process.env.RUNNER_TEMP
  if (typeof runnerTemp !== 'string' || !resolve(runnerTemp)) {
    throw new TrustedMergeHold('host_env_blocked', 'runner_temp_missing')
  }
  const resultPath = resolve(runnerTemp, 'trusted-host-merge-result.json')
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Trusted host merge result',
      '',
      `- Status: \`${result.status}\``,
      `- PR: \`${result.prNumber ?? 'unknown'}\``,
      `- Head: \`${result.headOid ?? 'unknown'}\``,
      `- Base: \`${result.baseOid ?? 'unknown'}\``,
      `- Merge commit: \`${result.mergeCommit ?? 'none'}\``,
      `- Held reason: \`${result.heldReason ?? 'none'}\``,
      `- Held detail: \`${result.heldDetail ?? 'none'}\``,
      '',
    ].join('\n')
    await appendPlatformFile(process.env.GITHUB_STEP_SUMMARY, summary)
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

let invocation = null
let terminalResult = null
try {
  if (resolve(process.cwd()) !== scriptRepoRoot) {
    throw new TrustedMergeHold('wrong_checkout', 'executor_cwd_not_trusted_base')
  }
  invocation = prepareInvocation(rawInput, context, contract)
  const assertion = buildBrokerAssertion(invocation, contract)
  const mode = process.argv[2]
  if (mode === 'challenge') {
    await outputChallenge(invocation, assertion)
  } else if (mode === 'execute') {
    if (process.platform !== 'linux' || process.version !== 'v20.20.2') {
      throw new TrustedMergeHold('host_env_blocked', 'trusted_toolchain_identity_mismatch')
    }
    const minted = await mintInstallationToken({
      apiBaseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
      appId: process.env.TRUSTED_MERGE_APP_ID,
      installationId: process.env.TRUSTED_MERGE_APP_INSTALLATION_ID,
      privateKey: process.env.TRUSTED_MERGE_APP_PRIVATE_KEY,
      repository: invocation.repo,
      permissions: contract.executor.github_app_token.permissions,
    })
    process.stdout.write(`::add-mask::${minted.token}\n`)
    const api = new GitHubApi({
      token: minted.token,
      apiBaseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
    })
    terminalResult = await executeTrustedMerge({
      api,
      invocation,
      assertion,
      contract,
      repoRoot: scriptRepoRoot,
      installationToken: minted.token,
      installationTokenExpiresAt: minted.expiresAt,
      apexApiKey: process.env.TRUSTED_MERGE_APEX_API_KEY,
      apexModel: process.env.TRUSTED_MERGE_APEX_MODEL,
    })
    await writeResult(terminalResult)
  } else {
    throw new TrustedMergeHold('invalid_args_format', 'mode_must_be_challenge_or_execute')
  }
} catch (error) {
  if (terminalResult?.merged === true) {
    const fallback = {
      ...terminalResult,
      status: 'merged_but_closeout_held',
      heldReason: 'merge_verification_failed',
      heldDetail: 'result_persistence_failed',
    }
    process.stdout.write(`${JSON.stringify(fallback)}\n`)
    process.exitCode = 2
  } else {
  const reason = error instanceof TrustedMergeHold ? error.reason : 'host_env_blocked'
  const detail = error instanceof TrustedMergeHold ? error.detail : 'trusted_executor_unexpected_failure'
  const result = heldResult(invocation, reason, detail)
  try { await writeResult(result) } catch { process.stdout.write(`${JSON.stringify(result)}\n`) }
  process.exitCode = 2
  }
}
