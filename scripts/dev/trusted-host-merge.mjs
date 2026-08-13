#!/usr/bin/env node

import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TrustedMergeHold,
  buildBrokerAssertion,
  heldResult,
  prepareInvocation,
  sha256,
  verifyActivationGate,
} from '../lib/trusted-host-merge.mjs'
import { createExecutionDeadline, executeTrustedMerge } from '../lib/trusted-host-merge-executor.mjs'
import { GitHubApi, mintInstallationToken } from '../lib/trusted-host-merge-runtime.mjs'


const scriptRepoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const contractPath = resolve(scriptRepoRoot, 'agent-contracts/trusted-host-merge.contract.json')
const contract = JSON.parse(await readFile(contractPath, 'utf8'))
const activationStatePath = resolve(
  scriptRepoRoot,
  'agent-contracts',
  contract.activation.state_contract.replace(/^\.\//u, ''),
)
const activationStateContract = JSON.parse(await readFile(activationStatePath, 'utf8'))

const rawInput = {
  prNumber: process.env.INPUT_PR_NUMBER,
  expectedHead: process.env.INPUT_EXPECTED_HEAD,
  expectedBase: process.env.INPUT_EXPECTED_BASE,
  expectedActivationMode: process.env.INPUT_EXPECTED_ACTIVATION_MODE,
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

const activationFor = (invocation) => ({
  activationState: activationStateContract.ship.activation_state,
  externalMode: process.env.TRUSTED_MERGE_ACTIVATION_MODE,
  attestationTupleSha256: process.env.TRUSTED_MERGE_ATTESTATION_TUPLE_SHA256 || '',
  invocation,
  contract,
})

const verifyTrustedToolchain = () => {
  if (
    process.platform !== contract.executor.toolchain.platform ||
    process.version !== contract.executor.toolchain.node_version
  ) {
    throw new TrustedMergeHold('host_env_blocked', 'trusted_toolchain_identity_mismatch')
  }
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
    activationMode: invocation.activationMode,
    expiresAt: invocation.expiresAt,
  })}\n`)
}

const writeResult = async (result) => {
  const serialized = `${JSON.stringify(result)}\n`
  process.stdout.write(serialized)
  const runnerTemp = process.env.RUNNER_TEMP
  if (typeof runnerTemp !== 'string' || runnerTemp.length === 0 || !isAbsolute(runnerTemp)) {
    throw new TrustedMergeHold('host_env_blocked', 'runner_temp_missing')
  }
  const resultPath = resolve(runnerTemp, 'trusted-host-merge-result.json')
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
  const persistence = async () => {
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    if (process.env.GITHUB_STEP_SUMMARY) await appendPlatformFile(process.env.GITHUB_STEP_SUMMARY, summary)
  }
  let persistenceTimeout = null
  try {
    await Promise.race([
      persistence(),
      new Promise((_, reject) => {
        persistenceTimeout = setTimeout(
          () => reject(new TrustedMergeHold('host_env_blocked', 'result_persistence_timeout')),
          contract.executor.pre_sink_timeouts.result_persistence_reserve_milliseconds,
        )
      }),
    ])
  } finally {
    if (persistenceTimeout !== null) clearTimeout(persistenceTimeout)
  }
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
  } else if (mode === 'activate') {
    verifyTrustedToolchain()
    const activationMode = verifyActivationGate(activationFor(invocation))
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'trusted-host-merge-activation/v1',
      status: 'allowed',
      mode: activationMode,
      prNumber: invocation.prNumber,
      headOid: invocation.headOid,
      baseOid: invocation.baseOid,
    })}\n`)
  } else if (mode === 'execute') {
    verifyTrustedToolchain()
    const activation = activationFor(invocation)
    verifyActivationGate(activation)
    const executionDeadline = createExecutionDeadline(contract)
    const minted = await mintInstallationToken({
      apiBaseUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
      appId: process.env.TRUSTED_MERGE_APP_ID,
      installationId: process.env.TRUSTED_MERGE_APP_INSTALLATION_ID,
      privateKey: process.env.TRUSTED_MERGE_APP_PRIVATE_KEY,
      repository: invocation.repo,
      permissions: contract.executor.github_app_token.permissions,
      timeoutMilliseconds: executionDeadline.timeout(
        contract.executor.pre_sink_timeouts.app_token_mint_milliseconds,
      ),
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
      activation,
      executionDeadline,
    })
    await writeResult(terminalResult)
    if (terminalResult.status === 'merge_outcome_unverified') process.exitCode = 2
  } else {
    throw new TrustedMergeHold('invalid_args_format', 'mode_must_be_challenge_activate_or_execute')
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
  } else if (terminalResult?.status === 'merge_outcome_unverified') {
    process.stdout.write(`${JSON.stringify(terminalResult)}\n`)
    process.exitCode = 2
  } else {
    const reason = error instanceof TrustedMergeHold ? error.reason : 'host_env_blocked'
    const detail = error instanceof TrustedMergeHold ? error.detail : 'trusted_executor_unexpected_failure'
    const result = heldResult(invocation, reason, detail)
    try { await writeResult(result) } catch { process.stdout.write(`${JSON.stringify(result)}\n`) }
    process.exitCode = 2
  }
}
