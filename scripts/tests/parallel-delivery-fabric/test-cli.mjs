import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runParallelDeliveryFabricCli } from '../../dev/parallel-delivery-fabric.mjs'
import { createParallelDeliveryFabric } from '../../lib/parallel-delivery-fabric.mjs'

const MAX_INPUT = 256 * 1024
const MAX_NODES = 512
const MAX_ARRAY_LENGTH = 128
const ROOT = path.resolve('C:\\fabric-cli-root')
const COMMANDS = Object.freeze(['submit', 'advance', 'reconcile', 'drain', 'release', 'inspect'])
const input = (value) => Buffer.from(JSON.stringify(value), 'utf8')
const snapshotNodes = (value) => {
  if (value === null || typeof value !== 'object') return 1
  return 1 + Reflect.ownKeys(value).filter((key) => key !== 'length').reduce((total, key) => total + snapshotNodes(value[key]), 0)
}
const nodeTree = (nodes) => {
  if (nodes === 1) return 'x'
  const childCount = Math.min(MAX_ARRAY_LENGTH - 1, nodes - 1)
  const remaining = nodes - 1 - childCount
  return Array.from({ length: childCount }, (_unused, index) => nodeTree(index === 0 ? remaining + 1 : 1))
}
const regular = (size = 1) => ({ size, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
const directory = () => ({ size: 0, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false })
const symlink = () => ({ size: 0, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true })
const identifiedFile = (size, dev = 1, ino = 2) => ({ size, dev, ino, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false })
const CLI_PATH = fileURLToPath(new URL('../../dev/parallel-delivery-fabric.mjs', import.meta.url))

const payloadFor = (command) => {
  if (command === 'inspect') return { plan_id: 'plan:one' }
  const base = { command_id: `command:${command}-one` }
  if (command === 'submit') return { ...base, plan: { plan_id: 'plan:one' }, expected_oid: 'a'.repeat(40), nonce: 'nonce-submit-one', execution: { level: 'plan_only', side_effect_class: 'CONTROL_METADATA' }, effects: { filesystem: 0, git: 0, network: 0, process: 0, provider: 0, github: 0, deploy: 0, cleanup: 0, promotion: 0 } }
  if (command === 'advance') return { ...base, envelope: { provider: 'codex', current_level: 'plan_only' }, advance_command: { next_level: 'implement_local' }, admission: { lease_id: 'lease:one' }, provider_request: { command: 'shadow-status' } }
  if (command === 'reconcile') return { ...base, reconcile_request: { lease_id: 'lease:one' } }
  if (command === 'drain') return { ...base, end_request: { lease_id: 'lease:one' } }
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
    planRegistry: { submit: async ({ plan }) => ({ status: 'STORED', plan_id: plan.plan_id }), inspect: async () => ({ oid: '0'.repeat(40), record: null }) },
    leaseRegistry: {
      admit: async ({ lease_id }) => ({ status: 'ADMITTED', lease_id }),
      reconcileTimeout: async ({ lease_id }) => ({ status: 'ACTIVE', lease_id }),
      endRequest: async ({ lease_id }) => ({ status: 'END_REQUESTED', lease_id }),
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

test('CLI accepts input with exactly 512 aggregate nodes', async () => {
  const nodes = payloadFor('submit')
  nodes.plan = { plan_id: 'plan:one' }
  nodes.plan.payload = nodeTree(MAX_NODES - snapshotNodes(nodes))
  assert.equal(snapshotNodes(nodes), MAX_NODES)
  const nodeSubject = fixture({ stdin: input(nodes) })
  assert.equal((await run(['submit', '--input', '-'], nodeSubject)).exitCode, 0)
  assert.equal(nodeSubject.calls.length, 1)
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

test('CLI contains input with 512 aggregate nodes plus one before Fabric', async () => {
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

test('CLI main remains inert and source contains no live or destructive sinks', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../dev/parallel-delivery-fabric.mjs', import.meta.url), 'utf8'))
  assert.match(source, /SHADOW_ONLY_INERT/u)
  assert.doesNotMatch(source, /node:(?:child_process|http|https|net|tls)|\b(?:spawn|exec|fork|fetch|writeFile|unlink|rmSync|git|deploy)\s*\(/u)
  assert.doesNotMatch(source, /createParallelDeliveryFabric|provider.*launch|process\.kill/iu)
})
