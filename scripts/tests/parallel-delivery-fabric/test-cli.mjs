import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runParallelDeliveryFabricCli } from '../../dev/parallel-delivery-fabric.mjs'
import { FABRIC_SCHEMA_VERSION, digestCanonical } from '../../lib/parallel-delivery-fabric-contract.mjs'
import { createLocalParallelDeliveryFabric } from '../../lib/parallel-delivery-fabric-local.mjs'
import { createParallelDeliveryFabric } from '../../lib/parallel-delivery-fabric.mjs'

const MAX_INPUT = 256 * 1024
const MAX_NODES = 4096
const MAX_ARRAY_LENGTH = 128
const ROOT = path.resolve('C:\\fabric-cli-root')
const COMMANDS = Object.freeze(['submit', 'advance', 'reconcile', 'drain', 'release', 'inspect'])
const input = (value) => Buffer.from(JSON.stringify(value), 'utf8')
const tempRepository = async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'fabric-local-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(initialized.status, 0, initialized.stderr)
  return root
}
const writeMalformedRef = (root, ref) => {
  const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '{}', encoding: 'utf8', windowsHide: true })
  assert.equal(blob.status, 0, blob.stderr)
  const updated = spawnSync('git', ['update-ref', '--no-deref', ref, blob.stdout.trim()], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(updated.status, 0, updated.stderr)
}
const localDeliveryPlan = () => ({
  schema_version: FABRIC_SCHEMA_VERSION,
  plan_id: 'plan:local-submit', generation: 1,
  repo_identity: { full_name: 'acme/bim', repository_id: 1, common_dir_digest: 'b'.repeat(64) },
  created_at: '2026-08-29T00:00:00.000Z', coordinator_session: 'session:coordinator',
  baseline_ref: 'origin/main', resolved_baseline_sha: 'a'.repeat(40),
  tasks: [{
    task_id: 'task:local-submit', outcome: 'local-shadow-plan', provider_preference: 'codex', owner_session: 'session:local-owner',
    scope: { owning_service: 'delivery-fabric', public_entrypoint: 'scripts/dev/parallel-delivery-fabric.mjs', resources: [{ kind: 'path', path: 'scripts/dev/parallel-delivery-fabric.mjs' }], expected_tests: ['test:local-cli'], e2e_required: false },
    dependencies: [], risk: 'bounded', e2e_required: false,
  }],
  requested_capacity: { writers: 1, runtime_leases: 0 }, branch_profile: 'trunk',
  acceptance_criteria: ['criterion:local-shadow'], promotion_mode: 'single_pr', requested_execution_level: 'plan_only',
  authority_reference: 'authority:local-shadow', governance_source_refs: ['openspec:parallel-delivery-fabric'],
})
const snapshotNodes = (value) => {
  if (value === null || typeof value !== 'object') return 1
  return 1 + Reflect.ownKeys(value).filter((key) => key !== 'length').reduce((total, key) => total + snapshotNodes(value[key]), 0)
}
// Builds a tree of exactly `nodes` aggregate nodes that stays within the dense
// array width and the depth budget by spreading the remainder across children.
const nodeTree = (nodes) => {
  if (nodes === 1) return 'x'
  const childCount = Math.min(MAX_ARRAY_LENGTH - 1, nodes - 1)
  let remaining = nodes - 1 - childCount
  return Array.from({ length: childCount }, () => {
    const extra = Math.min(remaining, MAX_ARRAY_LENGTH - 1)
    remaining -= extra
    return nodeTree(1 + extra)
  })
}
const regular = (size = 1) => ({ size, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
const directory = () => ({ size: 0, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
const symlink = () => ({ size: 0, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true })
const identifiedFile = (size, dev = 1, ino = 2) => ({ size, dev, ino, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
const CLI_PATH = fileURLToPath(new URL('../../dev/parallel-delivery-fabric.mjs', import.meta.url))
const ADVANCE_SCOPE_DIGEST = digestCanonical([{ kind: 'path', path: 'scripts/fabric.mjs' }])
const ADVANCE_TUPLE = Object.freeze({
  plan_id: 'plan:one', generation: 1, task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex',
  provider_session_id: 'provider:one', execution_context_id: 'context:one', repo_identity_digest: 'a'.repeat(64),
  common_dir_digest: 'b'.repeat(64), worktree_id: 'worktree:one', worktree_path_digest: 'c'.repeat(64),
  branch: 'codex/fabric-one', baseline_sha: 'a'.repeat(40), head_sha: 'b'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST,
  lease_id: 'lease:one',
})

const payloadFor = (command) => {
  if (command === 'inspect') return { plan_id: 'plan:one' }
  const base = { command_id: `command:${command}-one` }
  if (command === 'submit') return { ...base, plan: { plan_id: 'plan:one' }, expected_oid: 'a'.repeat(40), nonce: 'nonce-submit-one', execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' }, effects: { filesystem: 0, git: 0, network: 0, process: 0, provider: 0, github: 0, deploy: 0, cleanup: 0, promotion: 0 } }
  if (command === 'advance') return {
    ...base,
    envelope: { ...ADVANCE_TUPLE, current_level: 'plan_only' },
    advance_command: { next_level: 'implement_local', next_envelope: { ...ADVANCE_TUPLE, current_level: 'implement_local' } },
    admission: { ...ADVANCE_TUPLE, context_attestation_ref: 'attestation:one', resource_keys: ['path:scripts/fabric.mjs'], nonce: 'n'.repeat(32) },
    provider_request: { command: 'shadow-status', execution_context: { expected: { ...ADVANCE_TUPLE }, attestation: { attestation_ref: 'attestation:one' } } },
  }
  if (command === 'reconcile') return { ...base, reconcile_request: { lease_id: 'lease:one' } }
  if (command === 'drain') return { ...base, drain_request: { plan_id: 'plan:one', generation: 1, expected_oid: 'a'.repeat(40), nonce: 'n'.repeat(32), reason: 'handoff', owner_attestation: { attestation_ref: 'attestation:drain-one', attestation_digest: 'c'.repeat(64), issuer_id: 'attestor:plan-owner', issuer_version: 'plan-owner/v1', action: 'drain', plan_id: 'plan:one', generation: 1, expected_oid: 'a'.repeat(40), nonce: 'n'.repeat(32), reason: 'handoff', observed_at: '2026-08-29T00:00:00.000Z', expires_at: '2026-08-29T00:10:00.000Z', revocation_epoch: 0 } } }
  return { ...base, release_request: { lease_id: 'lease:one', expected_oid: 'a'.repeat(40), expected_envelope_oid: 'b'.repeat(40), expected_envelope_transition_sequence: 0, attestation: { attestation_ref: 'attestation:owner-end-one', attestation_digest: 'c'.repeat(64), issuer_id: 'attestor:owner-end', issuer_version: 'owner-end/v1', owner_session: 'session:owner-one', provider: 'codex', provider_session_id: 'provider:one', execution_context_id: 'context:one', lease_id: 'lease:one', generation: 1, head_sha: 'd'.repeat(40), scope_digest: 'e'.repeat(64), worktree_path_digest: 'f'.repeat(64), observed_at: '2026-08-29T00:00:00.000Z', expires_at: '2026-08-29T00:10:00.000Z', nonce: 'a'.repeat(32), revocation_epoch: 0 } } }
}

const inspectSuccess = (planId) => ({ plan_id: planId, plan: { oid: '0'.repeat(40), record: null }, leases: { oid: '0'.repeat(40), record: null } })
const dispatchSuccess = (command) => ({ command_id: command.command_id, type: command.type, status: command.type === 'advance' ? 'SHADOW_INTENT' : 'SHADOW_STORED', reason: 'SHADOW_OK' })
const fixture = ({ stdin = input(payloadFor('submit')), dispatch = dispatchSuccess, inspect = inspectSuccess, io: ioOverrides = {} } = {}) => {
  const calls = []
  const output = []
  const fabric = {
    dispatch: async (command) => { calls.push({ dispatch: command }); return dispatch(command) },
    inspect: async (planId) => { calls.push({ inspect: planId }); return inspect(planId) },
  }
  const io = { readStdin: async () => stdin, write: (line) => output.push(line), ...ioOverrides }
  return { calls, output, fabric, io }
}
const run = (argv, subject, repositoryRoot = ROOT) => runParallelDeliveryFabricCli(argv, { fabric: subject.fabric, io: subject.io, repositoryRoot })
const assertHeld = (subject, result) => {
  assert.equal(result.exitCode, 1)
  assert.equal(subject.calls.length, 0)
  assert.equal(subject.output.length, 1)
  assert.equal(JSON.parse(subject.output[0]).status, 'HELD')
}
const pathIo = ({ source = 'input.json', root = ROOT, nodes = new Map(), bytes = input(payloadFor('submit')), onRead = undefined } = {}) => {
  const leaf = path.join(root, ...source.split('/'))
  if (!nodes.has(root)) nodes.set(root, { stat: directory(), realpath: root })
  if (!nodes.has(leaf)) nodes.set(leaf, { stat: regular(bytes.length), realpath: leaf })
  return {
    lstat: (entry) => nodes.get(entry)?.stat ?? regular(bytes.length),
    stat: (entry) => nodes.get(entry)?.stat ?? regular(bytes.length),
    realpath: (entry) => nodes.get(entry)?.realpath ?? entry,
    readFile: (entry) => { onRead?.(entry); return bytes },
  }
}
const handleIo = ({ source = 'input.json', root = ROOT, bytes = input(payloadFor('submit')), onRead = undefined } = {}) => {
  const leaf = path.join(root, ...source.split('/'))
  const nodes = new Map([[root, { stat: directory(), realpath: root }], [leaf, { stat: identifiedFile(bytes.length), realpath: leaf }]])
  const calls = { close: 0, open: 0, read: 0 }
  return {
    calls,
    io: {
      lstat: (entry) => nodes.get(entry)?.stat,
      realpath: (entry) => nodes.get(entry)?.realpath,
      stat: (entry) => nodes.get(entry)?.stat,
      open: (entry) => { calls.open += 1; return { entry, stat: nodes.get(entry)?.stat } },
      fstat: (handle) => handle.stat,
      read: (handle, buffer, offset, length, position) => {
        calls.read += 1
        onRead?.(handle, nodes)
        const chunk = bytes.subarray(position, position + length)
        chunk.copy(buffer, offset)
        return chunk.length
      },
      close: () => { calls.close += 1 },
    },
  }
}
const coreFabric = (calls) => {
  const receipts = new Map()
  return createParallelDeliveryFabric({
    commandJournal: {
      read: async ({ command_id, journal_key }) => { calls.read += 1; return receipts.get(journal_key ?? command_id) ?? null },
      reserve: async (request) => {
        const { command_id, command_digest, attempt_id, reservation_id, journal_key } = request
        const receipt = { ...(journal_key === undefined ? {} : { journal_key }), command_id, command_digest, attempt_id, reservation_id, status: 'RESERVED', acquired: true }
        receipts.set(journal_key ?? command_id, receipt)
        return receipt
      },
      commit: async (request) => {
        const { command_id, command_digest, attempt_id, reservation_id, outcome_digest, outcome, journal_key } = request
        const receipt = { ...(journal_key === undefined ? {} : { journal_key }), command_id, command_digest, attempt_id, reservation_id, outcome_digest, status: 'COMMITTED', outcome }
        receipts.set(journal_key ?? command_id, receipt)
        return receipt
      },
    },
    planRegistry: {
      submit: async ({ plan }) => ({ status: 'STORED', plan_id: plan.plan_id }),
      validateGeneration: async ({ plan_id, generation, task_id }) => {
        const active = { status: 'ACTIVE', plan_id, generation, oid: 'f'.repeat(40) }
        return task_id === undefined ? active : {
          ...active,
          task: {
            task_id: 'task:one', owner_session: 'session:owner-one', provider: 'codex',
            baseline_sha: 'a'.repeat(40), scope_digest: ADVANCE_SCOPE_DIGEST, dependencies: [],
          },
        }
      },
      inspect: async () => ({ oid: '0'.repeat(40), record: null }),
    },
    leaseRegistry: {
      admit: async ({ lease_id }) => ({ status: 'ADMITTED', lease_id }),
      validateActive: async ({ lease_id }) => ({ status: 'ACTIVE', lease_id }),
      validateDependencies: async ({ plan_id, generation, task_id, dependency_task_ids, expected_parent_sha }) => ({
        status: 'READY', plan_id, generation, task_id, expected_parent_sha, dependency_count: dependency_task_ids.length,
      }),
      reconcileTimeout: async ({ lease_id }) => ({ status: 'ACTIVE', lease_id }),
      drainPlan: async ({ plan_id }) => ({ status: 'DRAINING', plan_id }),
      release: async () => ({ status: 'RELEASED', oid: 'b'.repeat(40), lease: { lease_id: 'lease:one', state: 'RELEASED', retention_state: 'RETAINED_FOR_REVIEW', release_record: { owner_end_attestation_ref: 'attestation:owner-end-one', owner_end_attestation_digest: 'c'.repeat(64) } } }),
      inspect: async () => ({ oid: '0'.repeat(40), record: null }),
    },
    execution: { advance: async (_envelope, advance) => ({ status: 'SHADOW_INTENT', next_level: advance.next_level }) },
    providerAdapters: { codex: { preflight: async () => ({ status: 'READY_FOR_SHADOW', provider: 'codex' }) }, claude: { preflight: async () => ({ status: 'READY_FOR_SHADOW', provider: 'claude' }) } },
    projection: { reconcile: async ({ reconciliation }) => ({ status: 'PROJECTION_READY', lease_id: reconciliation.lease_id }) },
  })
}

test('CLI permits exactly six command names and keeps shadow policy out of the core command', async () => {
  for (const command of COMMANDS) {
    const subject = fixture({ stdin: input(payloadFor(command)) })
    const result = await run([command, '--input', '-'], subject)
    assert.equal(result.exitCode, 0, command)
    assert.equal(subject.calls.length, 1, command)
    if (command === 'inspect') assert.deepEqual(subject.calls[0], { inspect: 'plan:one' })
    else {
      assert.equal(subject.calls[0].dispatch.type, command)
      assert.equal(Object.hasOwn(subject.calls[0].dispatch, 'mode'), false)
    }
  }
  const seventh = fixture()
  assertHeld(seventh, await run(['merge', '--input', '-'], seventh))
})

test('CLI calls the real Fabric five-command seam without COMMAND_SCHEMA_INVALID', async () => {
  for (const command of ['submit', 'advance', 'reconcile', 'drain', 'release']) {
    const calls = { read: 0 }
    const subject = fixture({ stdin: input(payloadFor(command)) })
    subject.fabric = coreFabric(calls)
    const result = await run([command, '--input', '-'], subject)
    assert.ok(calls.read > 0, command)
    assert.equal(result.exitCode, command === 'release' ? 1 : 0, command)
  }
})

test('CLI direct entry normalizes argv paths and emits a fixed held JSON for no arguments', () => {
  const direct = spawnSync(process.execPath, ['scripts/dev/parallel-delivery-fabric.mjs'], {
    cwd: path.resolve(path.dirname(CLI_PATH), '../..'),
    encoding: 'utf8',
  })
  assert.notEqual(direct.status, 0)
  assert.deepEqual(JSON.parse(direct.stdout.trim()), { status: 'HELD', error: 'CLI_ARGUMENTS_INVALID' })
})

test('CLI rejects live, duplicate, selector-override, and arbitrary command payloads before fabric', async () => {
  for (const argv of [['submit', '--live', '--input', '-'], ['submit', '--input', '-', '--input', '-'], ['submit', '--input', '-', '--mode', 'live']]) {
    const subject = fixture()
    assertHeld(subject, await run(argv, subject))
  }
  for (const payload of [{ ...payloadFor('submit'), type: 'release' }, { ...payloadFor('submit'), mode: 'live' }, { ...payloadFor('submit'), extra: true }, { command_id: 'command:advance-one', arbitrary: {} }]) {
    const command = Object.hasOwn(payload, 'arbitrary') ? 'advance' : 'submit'
    const subject = fixture({ stdin: input(payload) })
    assertHeld(subject, await run([command, '--input', '-'], subject))
  }
  for (const payload of [{}, { plan_id: '../plan' }]) {
    const subject = fixture({ stdin: input(payload) })
    assertHeld(subject, await run(['inspect', '--input', '-'], subject))
  }
})

test('CLI treats HELD, UNKNOWN, malformed, and thrown fabric results as non-success', async () => {
  for (const result of [{ status: 'HELD', reason: 'SHADOW_ONLY' }, { status: 'UNKNOWN', reason: 'UNKNOWN_RESULT' }, { command_id: 'command:submit-one', type: 'submit', status: 'MERGED', reason: 'FORGED' }, { command_id: 'command:submit-one', type: 'submit', status: 'SHADOW_STORED' }]) {
    const subject = fixture({ dispatch: () => result })
    const response = await run(['submit', '--input', '-'], subject)
    assert.equal(response.exitCode, 1)
    assert.equal(subject.output.length, 1)
  }
  const throwing = fixture({ dispatch: () => { throw new Error('do not echo') } })
  const response = await run(['submit', '--input', '-'], throwing)
  assert.equal(response.exitCode, 1)
  assert.equal(JSON.parse(throwing.output[0]).error, 'CLI_FABRIC_UNAVAILABLE')
})

test('CLI snapshots argv and fabric results without invoking hostile accessors', async () => {
  const argv = ['submit', '--input', '-']
  let argvReads = 0
  Object.defineProperty(argv, '0', { enumerable: true, get: () => { argvReads += 1; return 'submit' } })
  const argvSubject = fixture()
  assertHeld(argvSubject, await run(argv, argvSubject))
  assert.equal(argvReads, 0)
  let resultReads = 0
  const resultSubject = fixture({ dispatch: () => Object.defineProperties({}, {
    command_id: { enumerable: true, get: () => { resultReads += 1; return 'command:submit-one' } },
    type: { enumerable: true, get: () => { resultReads += 1; return 'submit' } },
    status: { enumerable: true, get: () => { resultReads += 1; return 'SHADOW_STORED' } },
    reason: { enumerable: true, get: () => { resultReads += 1; return 'SHADOW_OK' } },
  }) })
  const response = await run(['submit', '--input', '-'], resultSubject)
  assert.equal(response.exitCode, 1)
  assert.equal(resultReads, 0)
})

test('CLI rejects prototype selectors and transparent Proxies before recursive inspection', async () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    const payload = payloadFor('submit')
    Object.defineProperty(payload.plan, key, { enumerable: true, value: { selector: true } })
    const subject = fixture({ stdin: input(payload) })
    assertHeld(subject, await run(['submit', '--input', '-'], subject))
  }
  let traps = 0
  const argv = new Proxy(['submit', '--input', '-'], {
    get: (...args) => { traps += 1; return Reflect.get(...args) },
    getOwnPropertyDescriptor: (...args) => { traps += 1; return Reflect.getOwnPropertyDescriptor(...args) },
    getPrototypeOf: (...args) => { traps += 1; return Reflect.getPrototypeOf(...args) },
    ownKeys: (...args) => { traps += 1; return Reflect.ownKeys(...args) },
  })
  const subject = fixture()
  assertHeld(subject, await run(argv, subject))
  assert.equal(traps, 0)
})

test('CLI stops bounded stdin streaming and rejects malformed UTF-8 before fabric', async () => {
  let canceled = false
  async function * stream () { try { yield Buffer.alloc(MAX_INPUT + 1, 0x61) } finally { canceled = true } }
  const oversized = fixture({ stdin: stream() })
  assertHeld(oversized, await run(['submit', '--input', '-'], oversized))
  assert.equal(canceled, true)
  const malformed = Buffer.concat([Buffer.from('{"plan_id":"plan:'), Buffer.from([0xff]), Buffer.from('one"}')])
  const malformedSubject = fixture({ stdin: malformed })
  assertHeld(malformedSubject, await run(['inspect', '--input', '-'], malformedSubject))
})

test('CLI accepts stdin transport bytes exactly at 256 KiB', async () => {
  const transport = payloadFor('submit')
  transport.nonce = ''
  transport.nonce = 'x'.repeat(MAX_INPUT - input(transport).length)
  assert.equal(input(transport).length, MAX_INPUT)
  const transportSubject = fixture({ stdin: input(transport) })
  assert.equal((await run(['submit', '--input', '-'], transportSubject)).exitCode, 0)
  assert.equal(transportSubject.calls.length, 1)
})

test('CLI accepts input with exactly the aggregate node budget', async () => {
  const nodes = payloadFor('submit')
  nodes.plan = { plan_id: 'plan:one' }
  nodes.plan.payload = nodeTree(MAX_NODES - snapshotNodes(nodes))
  assert.equal(snapshotNodes(nodes), MAX_NODES)
  const nodeSubject = fixture({ stdin: input(nodes) })
  assert.equal((await run(['submit', '--input', '-'], nodeSubject)).exitCode, 0)
  assert.equal(nodeSubject.calls.length, 1)
})

test('P1 regression — a contract-maximum 64-task delivery plan fits the CLI node budget', async () => {
  const plan = localDeliveryPlan()
  const [template] = plan.tasks
  plan.tasks = Array.from({ length: 64 }, (_unused, index) => ({
    ...template,
    task_id: `task:max-${index}`,
    scope: { ...template.scope, public_entrypoint: `scripts/dev/max-${index}.mjs`, resources: [{ kind: 'path', path: `scripts/dev/max-${index}.mjs` }], expected_tests: [`test:max-${index}`] },
  }))
  const payload = { ...payloadFor('submit'), plan }
  // The old 512-node cap rejected every valid plan of this size before Fabric saw it.
  assert.ok(snapshotNodes(payload) > 512)
  assert.ok(snapshotNodes(payload) <= MAX_NODES)
  const subject = fixture({ stdin: input(payload) })
  assert.equal((await run(['submit', '--input', '-'], subject)).exitCode, 0)
  assert.equal(subject.calls.length, 1)
})

test('P2 regression — a contract-valid namespaced plan id is inspectable through the CLI', async () => {
  const subject = fixture({ stdin: input({ plan_id: 'plan:foo/bar' }) })
  assert.equal((await run(['inspect', '--input', '-'], subject)).exitCode, 0)
  assert.deepEqual(subject.calls[0], { inspect: 'plan:foo/bar' })
  const unnamespaced = fixture({ stdin: input({ plan_id: 'not-namespaced' }) })
  assertHeld(unnamespaced, await run(['inspect', '--input', '-'], unnamespaced))
})

test('CLI accepts input with a dense array of exactly 128 elements', async () => {
  const array = payloadFor('submit')
  array.plan = { plan_id: 'plan:one', payload: Array.from({ length: MAX_ARRAY_LENGTH }, () => 'x') }
  const arraySubject = fixture({ stdin: input(array) })
  assert.equal((await run(['submit', '--input', '-'], arraySubject)).exitCode, 0)
  assert.equal(arraySubject.calls.length, 1)
})

test('CLI contains stdin transport bytes at 256 KiB plus one before Fabric', async () => {
  const transport = payloadFor('submit')
  transport.nonce = ''
  transport.nonce = 'x'.repeat(MAX_INPUT - input(transport).length + 1)
  assert.equal(input(transport).length, MAX_INPUT + 1)
  const transportSubject = fixture({ stdin: input(transport) })
  assertHeld(transportSubject, await run(['submit', '--input', '-'], transportSubject))
})

test('CLI contains input with the aggregate node budget plus one before Fabric', async () => {
  const nodes = payloadFor('submit')
  nodes.plan = { plan_id: 'plan:one' }
  nodes.plan.payload = nodeTree(MAX_NODES - snapshotNodes(nodes) + 1)
  assert.equal(snapshotNodes(nodes), MAX_NODES + 1)
  const nodeSubject = fixture({ stdin: input(nodes) })
  assertHeld(nodeSubject, await run(['submit', '--input', '-'], nodeSubject))
})

test('CLI contains input with a dense array of 129 elements before Fabric', async () => {
  const array = payloadFor('submit')
  array.plan = { plan_id: 'plan:one', payload: Array.from({ length: MAX_ARRAY_LENGTH + 1 }, () => 'x') }
  const arraySubject = fixture({ stdin: input(array) })
  assertHeld(arraySubject, await run(['submit', '--input', '-'], arraySubject))
})

test('CLI anchors JSON files under the injected root and rejects oversized, escaping, and reparse paths', async () => {
  let oversizedReads = 0
  const tooLarge = fixture({ io: pathIo({ bytes: Buffer.alloc(MAX_INPUT + 1), onRead: () => { oversizedReads += 1 } }) })
  assertHeld(tooLarge, await run(['submit', '--input', 'input.json'], tooLarge))
  assert.equal(oversizedReads, 0)
  for (const source of ['../escape.json', '/tmp/input.json', 'C:/input.json', 'file:///input.json', 'https://example.test/input.json']) {
    const subject = fixture({ io: pathIo() })
    assertHeld(subject, await run(['submit', '--input', source], subject))
  }
  for (const [source, nodePath] of [['nested/input.json', path.join(ROOT, 'nested')], ['input.json', path.join(ROOT, 'input.json')]]) {
    const leaf = path.join(ROOT, ...source.split('/'))
    const nodes = new Map([[ROOT, { stat: directory(), realpath: ROOT }], [leaf, { stat: regular(), realpath: leaf }], [nodePath, { stat: symlink(), realpath: nodePath }]])
    const subject = fixture({ io: pathIo({ source, nodes }) })
    assertHeld(subject, await run(['submit', '--input', source], subject))
  }
  const leaf = path.join(ROOT, 'outside.json')
  const escaping = fixture({ io: pathIo({ source: 'outside.json', nodes: new Map([[ROOT, { stat: directory(), realpath: ROOT }], [leaf, { stat: regular(), realpath: path.resolve('C:\\outside\\outside.json') }]]) }) })
  assertHeld(escaping, await run(['submit', '--input', 'outside.json'], escaping))
})

test('CLI reads rooted files through an identity-pinned bounded handle and rejects deterministic swaps', async () => {
  const cleanHandle = handleIo()
  const clean = fixture({ io: cleanHandle.io })
  assert.equal((await run(['submit', '--input', 'input.json'], clean)).exitCode, 0)
  assert.ok(cleanHandle.calls.open > 0)
  assert.ok(cleanHandle.calls.read > 0)
  assert.ok(cleanHandle.calls.close > 0)

  const swappedHandle = handleIo({ onRead: (handle, nodes) => nodes.set(handle.entry, { stat: symlink(), realpath: handle.entry }) })
  const swapped = fixture({ io: swappedHandle.io })
  assertHeld(swapped, await run(['submit', '--input', 'input.json'], swapped))

  const grownHandle = handleIo({ onRead: (handle) => { handle.stat = identifiedFile(MAX_INPUT + 1) } })
  const grown = fixture({ io: grownHandle.io })
  assertHeld(grown, await run(['submit', '--input', 'input.json'], grown))
})

test('CLI suppresses private host-shaped input and oversized or unserializable output', async () => {
  for (const unsafe of [{ location: '/home/operator/secret.json' }, { endpoint: '\\\\server\\share\\secret.json' }, { identity: 'S-1-5-21-111-222-333-1001' }, { processId: '4242' }, { machine: 'host: DESKTOP-7VF1E3D' }]) {
    const subject = fixture({ stdin: input({ ...payloadFor('submit'), ...unsafe }) })
    assertHeld(subject, await run(['submit', '--input', '-'], subject))
  }
  const hugeInspect = fixture({ stdin: input(payloadFor('inspect')), inspect: (planId) => ({ plan_id: planId, plan: { oid: '0'.repeat(40), record: { note: 'x'.repeat(128 * 1024) } }, leases: { oid: '0'.repeat(40), record: null } }) })
  const huge = await run(['inspect', '--input', '-'], hugeInspect)
  assert.equal(huge.exitCode, 1)
  assert.deepEqual(JSON.parse(hugeInspect.output[0]), { status: 'HELD', error: 'CLI_FABRIC_RESULT_UNSUCCESSFUL' })
  const unserializable = fixture({ dispatch: () => ({ command_id: 'command:submit-one', type: 'submit', status: 'SHADOW_STORED', reason: 'SHADOW_OK', value: 1n }) })
  const bad = await run(['submit', '--input', '-'], unserializable)
  assert.equal(bad.exitCode, 1)
  assert.equal(JSON.parse(unserializable.output[0]).status, 'HELD')
})

test('CLI projects inspect output through a closed redacted allow-list and budgets it before serialization', async () => {
  const safe = fixture({ stdin: input(payloadFor('inspect')), inspect: (planId) => ({
    plan_id: planId,
    plan: { oid: '0'.repeat(40), record: { harmless: 'present' } },
    leases: { oid: '0'.repeat(40), record: { leases: {} } },
  }) })
  assert.equal((await run(['inspect', '--input', '-'], safe)).exitCode, 0)
  assert.deepEqual(JSON.parse(safe.output[0]), { plan_id: 'plan:one', plan: { oid: '0'.repeat(40) }, leases: { oid: '0'.repeat(40) } })

  for (const key of ['apiKey', 'api_key', 'workerPid', 'ownerSid', 'hostName', 'filePath', 'cookie', 'env', 'transcript', 'credential']) {
    const subject = fixture({ stdin: input(payloadFor('inspect')), inspect: (planId) => ({
      plan_id: planId,
      plan: { oid: '0'.repeat(40), record: { nested: { [key]: 'redacted' } } },
      leases: { oid: '0'.repeat(40), record: null },
    }) })
    const result = await run(['inspect', '--input', '-'], subject)
    assert.equal(result.exitCode, 1, key)
    assert.deepEqual(JSON.parse(subject.output[0]).status, 'HELD')
    assert.doesNotMatch(subject.output[0], /redacted|apiKey|workerPid|ownerSid|hostName|filePath/iu)
  }

  const budget = fixture({ stdin: input(payloadFor('inspect')), inspect: (planId) => ({
    plan_id: planId,
    plan: { oid: '0'.repeat(40), record: { note: 'x'.repeat(MAX_INPUT) } },
    leases: { oid: '0'.repeat(40), record: null },
  }) })
  const result = await run(['inspect', '--input', '-'], budget)
  assert.equal(result.exitCode, 1)
  assert.deepEqual(JSON.parse(budget.output[0]).status, 'HELD')
})

test('CLI rejects oversized benign inspect property keys before oid-only projection', async () => {
  const oversizedKey = 'k'.repeat(64 * 1024 + 1)
  for (const record of [{ [oversizedKey]: 'benign' }, { nested: { [oversizedKey]: 'benign' } }]) {
    const subject = fixture({ stdin: input(payloadFor('inspect')), inspect: (planId) => ({
      plan_id: planId,
      plan: { oid: '0'.repeat(40), record },
      leases: { oid: '0'.repeat(40), record: null },
    }) })
    const result = await run(['inspect', '--input', '-'], subject)
    assert.equal(result.exitCode, 1)
    assert.deepEqual(JSON.parse(subject.output[0]).status, 'HELD')
    assert.doesNotMatch(subject.output[0], /k{64}/u)
  }
})

test('CLI main composes the local durable shadow seam without live or destructive sinks', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../dev/parallel-delivery-fabric.mjs', import.meta.url), 'utf8'))
  const localSource = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../lib/parallel-delivery-fabric-local.mjs', import.meta.url), 'utf8'))
  assert.match(source, /createLocalParallelDeliveryFabric/u)
  assert.doesNotMatch(source, /SHADOW_ONLY_INERT/u)
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)|\b(?:spawn|exec|fork|fetch|writeFile|unlink|rmSync|git|deploy)\s*\(/u)
  assert.match(localSource, /createCommandJournal/u)
  assert.match(localSource, /createGitCasStore/u)
  assert.match(localSource, /createParallelDeliveryFabric/u)
  assert.doesNotMatch(localSource, /node:(?:http|https|net|tls)|\b(?:fetch|writeFile|unlink|rmSync|deploy)\s*\(|\bgit\s+(?:push|fetch|remote|worktree|reset|clean|branch|rebase)\b|\bgh\s+pr\s+(?:merge|review)\b|provider.*launch/iu)
})

test('local durable composition completes an inspect CLI smoke against an isolated Git repository', async (context) => {
  const repositoryRoot = await tempRepository(context)
  const fabric = await createLocalParallelDeliveryFabric({ repositoryRoot })
  const output = []
  const result = await runParallelDeliveryFabricCli(['inspect', '--input', '-'], {
    fabric,
    repositoryRoot,
    io: { readStdin: async () => input({ plan_id: 'plan:local-smoke' }), write: (line) => output.push(line) },
  })
  assert.deepEqual(result, { exitCode: 0 })
  assert.deepEqual(JSON.parse(output[0]), {
    plan_id: 'plan:local-smoke', plan: { oid: '0'.repeat(40) }, leases: { oid: '0'.repeat(40) },
  })
})

test('local durable composition persists and replays a plan-only submit through the CLI seam', async (context) => {
  const repositoryRoot = await tempRepository(context)
  const payload = {
    command_id: 'command:local-submit', plan: localDeliveryPlan(), expected_oid: '0'.repeat(40), nonce: 'local-submit-nonce'.padEnd(32, 'n'),
    execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' },
    effects: { filesystem: 0, git: 0, network: 0, process: 0, provider: 0, github: 0, deploy: 0, cleanup: 0, promotion: 0 },
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fabric = await createLocalParallelDeliveryFabric({ repositoryRoot })
    const output = []
    const result = await runParallelDeliveryFabricCli(['submit', '--input', '-'], {
      fabric, repositoryRoot,
      io: { readStdin: async () => input(payload), write: (line) => output.push(line) },
    })
    assert.deepEqual(result, { exitCode: 0 }, JSON.stringify(output))
    assert.deepEqual(JSON.parse(output[0]), { command_id: payload.command_id, type: 'submit', status: 'SHADOW_STORED', reason: 'PLAN_STORED' })
  }
  const inspected = await (await createLocalParallelDeliveryFabric({ repositoryRoot })).inspect(payload.plan.plan_id)
  assert.equal(inspected.plan.record.plan.plan_id, payload.plan.plan_id)
  assert.notEqual(inspected.plan.oid, '0'.repeat(40))
})

for (const ref of ['refs/ai-bim/delivery-plans', 'refs/ai-bim/session-leases']) {
  test(`local durable inspect fails closed for a malformed ${ref} record`, async (context) => {
    const repositoryRoot = await tempRepository(context)
    writeMalformedRef(repositoryRoot, ref)
    const fabric = await createLocalParallelDeliveryFabric({ repositoryRoot })
    const result = await fabric.inspect('plan:corrupt-probe')
    assert.equal(result.status, 'HELD')
    assert.equal(result.reason, 'INSPECT_UNAVAILABLE')
  })
}
