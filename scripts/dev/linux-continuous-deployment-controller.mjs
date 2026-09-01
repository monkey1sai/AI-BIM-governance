import { mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalJson, sha256 } from '../lib/autonomous-delivery-contract.mjs'
import {
  parseTerminalDeliveryAttestation,
  runLinuxContinuousDeployment,
} from '../lib/linux-continuous-deployment.mjs'

const SHA1 = /^[0-9a-f]{40}$/u
const EXPECTED_REPOSITORY = 'monkey1sai/AI-BIM-governance'
const DEPLOYMENT_METHOD = 'scripts/dev/rebuild-test-deploy.ps1 -Build'

const invalid = (message) => {
  throw new Error(`linux_cd_controller_invalid_input: ${message}`)
}

const requiredObject = (value, name) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} must be an object`)
  return value
}

const requiredSha = (value, name) => {
  if (typeof value !== 'string' || !SHA1.test(value)) invalid(`${name} must be an exact commit SHA`)
  return value
}

export function buildProvisioningBoundaryFromGithubEvent(eventRaw, { now = new Date() } = {}) {
  const event = requiredObject(eventRaw, 'event')
  const repository = requiredObject(event.repository, 'event.repository')
  const pullRequest = requiredObject(event.pull_request, 'event.pull_request')
  const base = requiredObject(pullRequest.base, 'event.pull_request.base')
  const head = requiredObject(pullRequest.head, 'event.pull_request.head')
  if (event.action !== 'closed' || pullRequest.merged !== true) invalid('only merged pull_request.closed is accepted')
  if (repository.full_name !== EXPECTED_REPOSITORY) invalid('repository is not the expected repository')
  if (base.ref !== 'main') invalid('base ref must be main')
  if (!Number.isSafeInteger(pullRequest.number) || pullRequest.number < 1) invalid('pull request number is invalid')
  const sourceHeadSha = requiredSha(head.sha, 'event.pull_request.head.sha')
  const mergeSha = requiredSha(pullRequest.merge_commit_sha, 'event.pull_request.merge_commit_sha')
  const requestedAt = new Date(pullRequest.merged_at ?? now).toISOString()
  const states = ['PROVISIONING_REQUIRED', 'HELD']
  const attestation = {
    schema_version: 'linux-continuous-deployment-attestation/v1',
    repository: repository.full_name,
    pull_request: pullRequest.number,
    source_head_sha: sourceHeadSha,
    trusted_merge_sha: mergeSha,
    artifact_sha256: null,
    environment: null,
    service: null,
    target_fingerprint: null,
    deployment_method: DEPLOYMENT_METHOD,
    timestamps: { requested_at: requestedAt, terminal_at: now.toISOString() },
    verification: [],
    outcome: { promotion: 'not_started', rollback: 'not_started' },
    release_lineage: {
      delivery_id: `github-pr-${pullRequest.number}-merge-${mergeSha}`,
      previous_known_good_release_id: null,
    },
    state_history_sha256: sha256(canonicalJson(states)),
    final_state: 'HELD',
    terminal_class: 'HELD',
    reason_code: 'PROVISIONING_REQUIRED',
  }
  return {
    schema_version: 'linux-continuous-deployment-controller-result/v1',
    final_state: 'HELD',
    states,
    attestation: parseTerminalDeliveryAttestation(attestation),
  }
}

export async function writeControllerResult(outputPath, result) {
  if (typeof outputPath !== 'string' || outputPath.trim() === '') invalid('output path is required')
  const resolved = path.resolve(outputPath)
  await mkdir(path.dirname(resolved), { recursive: true })
  const handle = await open(resolved, 'wx', 0o600)
  try {
    await handle.writeFile(`${canonicalJson(result)}\n`, 'utf8')
  } finally {
    await handle.close()
  }
  return resolved
}

const parseArgs = (argv) => {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!['--github-event', '--request', '--output'].includes(name) || value === undefined) {
      invalid('usage: --github-event <path> | --request <path> --output <path>')
    }
    if (Object.hasOwn(parsed, name)) invalid(`duplicate argument ${name}`)
    parsed[name] = value
  }
  if (typeof parsed['--output'] !== 'string') invalid('--output is required')
  if ((parsed['--github-event'] === undefined) === (parsed['--request'] === undefined)) {
    invalid('exactly one of --github-event or --request is required')
  }
  return parsed
}

async function main(argv) {
  const args = parseArgs(argv)
  let result
  if (args['--github-event']) {
    const event = JSON.parse(await readFile(path.resolve(args['--github-event']), 'utf8'))
    result = buildProvisioningBoundaryFromGithubEvent(event)
  } else {
    const request = JSON.parse(await readFile(path.resolve(args['--request']), 'utf8'))
    result = runLinuxContinuousDeployment(request)
  }
  await writeControllerResult(args['--output'], result)
  process.stdout.write(`${canonicalJson({
    schema_version: 'linux-continuous-deployment-controller-summary/v1',
    final_state: result.final_state,
    reason_code: result.attestation.reason_code,
  })}\n`)
  process.exitCode = result.final_state === 'HELD' ? 2 : 0
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
  })
}
