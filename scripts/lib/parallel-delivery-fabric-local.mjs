import { spawn } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'

import { advanceExecutionEnvelope } from './parallel-delivery-fabric-admission.mjs'
import {
  createCommandJournal,
  createGitCasStore,
  createLeaseRegistry,
  createPlanRegistry,
} from './parallel-delivery-fabric-registry.mjs'
import { createParallelDeliveryFabric } from './parallel-delivery-fabric.mjs'

const MAX_GIT_OUTPUT = 1024 * 1024
const ZERO_OID = '0'.repeat(40)
const PLAN_REF = /^refs\/ai-bim\/delivery-plans(?:\/[0-9a-f]{64})?$/u
const SAFE_REASON = /^[A-Za-z0-9_:-]{1,128}$/u

const safeReason = (value, fallback) => typeof value === 'string' && SAFE_REASON.test(value) ? value : fallback
const held = (reason) => Object.freeze({ status: 'HELD', reason })

const gitEnvironment = (overrides = {}) => Object.freeze({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))),
  ...overrides,
})

const runGitProcess = (cwd, args, input = undefined, env = undefined) => new Promise((resolve) => {
  let settled = false
  let stdout = Buffer.alloc(0)
  let stderr = Buffer.alloc(0)
  const finish = (result) => {
    if (settled) return
    settled = true
    resolve(result)
  }
  const child = spawn('git', args, {
    cwd,
    env: gitEnvironment(env),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const collect = (current, chunk) => {
    const next = Buffer.concat([current, Buffer.from(chunk)])
    if (next.length > MAX_GIT_OUTPUT) {
      child.kill()
      finish({ exitCode: 1, stdout: '', stderr: 'git_output_limit' })
      return current
    }
    return next
  }
  child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk) })
  child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk) })
  child.on('error', () => finish({ exitCode: 1, stdout: '', stderr: 'git_unavailable' }))
  child.on('close', (code) => finish({
    exitCode: Number.isInteger(code) ? code : 1,
    stdout: stdout.toString('utf8'),
    stderr: stderr.toString('utf8'),
  }))
  if (input === undefined) child.stdin.end()
  else child.stdin.end(input, 'utf8')
})

const resolveRepository = async (repositoryRoot) => {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) throw new TypeError('repository_root_invalid')
  const root = await realpath(repositoryRoot)
  const rootStat = await stat(root)
  if (!rootStat.isDirectory()) throw new TypeError('repository_root_invalid')
  const result = await runGitProcess(root, ['rev-parse', '--git-common-dir'])
  if (result.exitCode !== 0) throw new TypeError('git_common_dir_unavailable')
  const rawCommonDir = result.stdout.trim()
  if (rawCommonDir.length === 0 || rawCommonDir.includes('\0')) throw new TypeError('git_common_dir_invalid')
  const commonDir = await realpath(path.isAbsolute(rawCommonDir) ? rawCommonDir : path.resolve(root, rawCommonDir))
  if (!(await stat(commonDir)).isDirectory()) throw new TypeError('git_common_dir_invalid')
  return Object.freeze({ root, commonDir })
}

const createLocalGitPort = (repositoryRoot) => Object.freeze({
  run: ({ args, input, env, commonDir }) => runGitProcess(repositoryRoot, [`--git-dir=${commonDir}`, ...args], input, env),
})

const snapshot = (value, expectedRef) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 3 || value.ref !== expectedRef ||
      !/^[0-9a-f]{40}$/u.test(value.oid) || !Object.hasOwn(value, 'record')) {
    throw new TypeError('registry_snapshot_invalid')
  }
  if (value.oid === ZERO_OID) return Object.freeze({ oid: ZERO_OID, record: null })
  if (value.record === null || typeof value.record !== 'object' || Array.isArray(value.record)) throw new TypeError('registry_snapshot_invalid')
  return Object.freeze({ oid: value.oid, record: value.record })
}
const planSnapshot = (value) => {
  if (!PLAN_REF.test(value?.ref ?? '')) throw new TypeError('registry_snapshot_invalid')
  return snapshot(value, value.ref)
}
const projectHeld = (value, fallback) => held(safeReason(value?.reason, fallback))

const projectPlanRegistry = (registry) => Object.freeze({
  async submit(input) {
    const result = await registry.submit(input)
    return result?.status === 'STORED'
      ? Object.freeze({ status: 'STORED', plan_id: input.plan.plan_id })
      : projectHeld(result, 'PLAN_REGISTRY_UNAVAILABLE')
  },
  validateGeneration: (input) => registry.validateGeneration(input),
  async inspect(planId) { return planSnapshot(await registry.inspect(planId)) },
})

const projectLeaseRegistry = (registry) => Object.freeze({
  async admit(input) {
    const result = await registry.admit(input)
    if (result?.status === 'ADMITTED') return Object.freeze({ status: 'ADMITTED', lease_id: input.lease_id })
    if (result?.status === 'QUEUED_FOR_LEASE') return Object.freeze({ status: 'QUEUED_FOR_LEASE', reason: safeReason(result.reason, 'LEASE_CAPACITY_UNAVAILABLE') })
    return projectHeld(result, 'ADMISSION_UNAVAILABLE')
  },
  validateActive: (input) => registry.validateActive(input),
  validateDependencies: (input) => registry.validateDependencies(input),
  async reconcileTimeout(input) {
    const result = await registry.reconcileTimeout(input)
    return ['ACTIVE', 'SUSPECT', 'NO_CHANGE'].includes(result?.status)
      ? Object.freeze({ status: result.status, lease_id: input.lease_id })
      : projectHeld(result, 'RECONCILE_UNAVAILABLE')
  },
  async drainPlan(input) {
    const result = await registry.drainPlan(input)
    return result?.status === 'DRAINING'
      ? Object.freeze({ status: 'DRAINING', plan_id: input.plan_id })
      : projectHeld(result, 'PLAN_DRAIN_UNAVAILABLE')
  },
  release: async () => held('RELEASE_AUTHORITY_UNAVAILABLE'),
  async inspect() { return snapshot(await registry.inspect(), 'refs/ai-bim/session-leases') },
})

const executionPort = Object.freeze({
  advance(envelope, command) {
    const result = advanceExecutionEnvelope(envelope, command)
    return result?.status === 'HELD_EXTERNAL_ACTIVATION' && result?.shadow_validation === 'VALID'
      ? Object.freeze({ status: 'SHADOW_INTENT', next_level: command.next_level })
      : projectHeld(result, 'EXECUTION_VALIDATION_UNAVAILABLE')
  },
})

const disabledProvider = Object.freeze({
  preflight: async () => held('PROVIDER_AUTHORITY_UNAVAILABLE'),
})

export async function createLocalParallelDeliveryFabric({ repositoryRoot } = {}) {
  const repository = await resolveRepository(repositoryRoot)
  const store = createGitCasStore({ git: createLocalGitPort(repository.root), commonDir: repository.commonDir })
  const clock = Object.freeze({ now: () => new Date().toISOString() })
  const planRegistry = projectPlanRegistry(createPlanRegistry({ store, clock }))
  const leaseRegistry = projectLeaseRegistry(createLeaseRegistry({ store, clock }))
  return createParallelDeliveryFabric({
    commandJournal: createCommandJournal({ store, clock }),
    planRegistry,
    leaseRegistry,
    execution: executionPort,
    providerAdapters: Object.freeze({ codex: disabledProvider, claude: disabledProvider }),
  })
}
