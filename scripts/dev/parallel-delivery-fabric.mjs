import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { types } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { isCanonicalOpaqueReference } from '../lib/parallel-delivery-fabric-contract.mjs'
import { createLocalParallelDeliveryFabric } from '../lib/parallel-delivery-fabric-local.mjs'

const COMMANDS = new Set(['submit', 'advance', 'reconcile', 'drain', 'release', 'inspect'])
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_INPUT = 256 * 1024
const MAX_OUTPUT = 64 * 1024
const MAX_DEPTH = 16
const MAX_KEYS = 128
// Sized for the delivery-plan contract's supported maximum (64 single-resource
// tasks is roughly 1,200 aggregate nodes), so plan size never becomes a de facto
// writer-count cap. The byte budget still bounds the input.
const MAX_NODES = 4096
const COMMAND_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/u
// Plan ids follow the contract's canonical opaque-reference grammar (namespaced,
// `/` allowed), so an id the parser and registry accept is also inspectable.
const PLAN_ID = { test: (value) => typeof value === 'string' && value.length <= 128 && isCanonicalOpaqueReference(value) }
const SAFE_REASON = /^[A-Za-z0-9_:-]{1,128}$/u
const FORBIDDEN_KEY = /^(?:__proto__|prototype|constructor)$/iu
const UNSAFE_KEY = /(?:api[_-]?key|secret|token|password|credential|private|cookie|authorization|bearer|transcript|process[_-]?id|worker[_-]?pid|owner[_-]?sid|host[_-]?name|file[_-]?path|(?:^|[_-])pid$|(?:^|[_-])sid$|absolute[_-]?path|(?:^|[_-])env(?:$|[_-])|^env_)/iu
const UNSAFE_VALUE = /(?:bearer|gh[pousr]_|github_pat_|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}|(?:^|[/:])S-\d+(?:-\d+){2,}|(?:^|:)\d{1,10}$|(?:^|:)[A-Za-z]:[\\/]|^(?:\\\\|\/)|\$env:|%[A-Za-z_][A-Za-z0-9_]*%|(?:^|\b)(?:pid|process(?:[_-]?id)?|worker[_-]?pid|owner[_-]?sid)\s*[:=]\s*\d+|(?:^|\b)(?:host(?:name)?|machine)\s*[:=]\s*[^\s]+|\b(?:DESKTOP|LAPTOP|WIN|HOST)-[A-Za-z0-9-]+\b|^\/)/iu
const DISPATCH_KEYS = Object.freeze({
  submit: ['command_id', 'plan', 'expected_oid', 'nonce', 'execution', 'effects'],
  advance: ['command_id', 'envelope', 'advance_command', 'admission', 'provider_request'],
  reconcile: ['command_id', 'reconcile_request'],
  drain: ['command_id', 'drain_request'],
  release: ['command_id', 'release_request'],
})
const SUCCESS_STATUSES = Object.freeze({
  submit: new Set(['SHADOW_STORED']),
  advance: new Set(['SHADOW_INTENT', 'QUEUED']),
  reconcile: new Set(['SHADOW_STORED']),
  drain: new Set(['SHADOW_STORED']),
  release: new Set(['SHADOW_STORED']),
})

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => isRecord(value) && Object.hasOwn(value, key)
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key))
const budgetKeys = (keys, state) => {
  if (keys.length > MAX_KEYS || keys.some((key) => typeof key !== 'string')) return false
  for (const key of keys) {
    if (FORBIDDEN_KEY.test(key) || UNSAFE_KEY.test(key) || key.length > state.maxBytes) return false
    state.bytes += Buffer.byteLength(key, 'utf8')
    if (state.bytes > state.maxBytes) return false
  }
  return true
}

const snapshotValue = (value, seen, state, depth) => {
  if (depth > MAX_DEPTH || value === undefined || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') return undefined
  state.nodes += 1
  if (state.nodes > MAX_NODES) return undefined
  if (typeof value === 'string') {
    if (value.length > state.maxBytes || UNSAFE_VALUE.test(value)) return undefined
    state.bytes += Buffer.byteLength(value, 'utf8')
    return state.bytes <= state.maxBytes ? value : undefined
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'object' || seen.has(value) || types.isProxy(value)) return undefined
  try {
    const prototype = Object.getPrototypeOf(value)
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype) return undefined
      const keys = Reflect.ownKeys(value)
      const length = Object.getOwnPropertyDescriptor(value, 'length')
      const indexKeys = keys.filter((key) => key !== 'length')
      if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 0 || length.value > MAX_KEYS || indexKeys.length !== length.value || !indexKeys.every((key) => typeof key === 'string' && /^(?:0|[1-9]\d*)$/u.test(key) && Number.isSafeInteger(Number(key)) && String(Number(key)) === key && Number(key) < length.value) || !budgetKeys(indexKeys, state)) return undefined
      const copy = []
      seen.add(value)
      for (let index = 0; index < length.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
        const nested = snapshotValue(descriptor.value, seen, state, depth + 1)
        if (nested === undefined) return undefined
        copy.push(nested)
      }
      return Object.freeze(copy)
    }
    if (prototype !== Object.prototype && prototype !== null) return undefined
    const keys = Reflect.ownKeys(value)
    if (!budgetKeys(keys, state)) return undefined
    const copy = Object.create(null)
    seen.add(value)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined
      const nested = snapshotValue(descriptor.value, seen, state, depth + 1)
      if (nested === undefined) return undefined
      Object.defineProperty(copy, key, { value: nested, enumerable: true, configurable: false, writable: false })
    }
    return Object.freeze(copy)
  } catch {
    return undefined
  }
}

const snapshot = (value, maxBytes = MAX_INPUT) => snapshotValue(value, new WeakSet(), { bytes: 0, maxBytes, nodes: 0 }, 0)

const ownValue = (value, key) => {
  if (!isRecord(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

const functionValue = (value, key) => {
  const candidate = ownValue(value, key)
  return typeof candidate === 'function' ? candidate : undefined
}

const configured = (options) => {
  if (!isRecord(options)) return undefined
  try {
    const keys = Reflect.ownKeys(options)
    if (keys.some((key) => typeof key !== 'string') || !keys.every((key) => ['fabric', 'io', 'repositoryRoot'].includes(key))) return undefined
    const fabric = ownValue(options, 'fabric')
    const io = ownValue(options, 'io')
    const repositoryRoot = ownValue(options, 'repositoryRoot') ?? REPOSITORY_ROOT
    const dispatch = functionValue(fabric, 'dispatch')
    const inspect = functionValue(fabric, 'inspect')
    const readStdin = functionValue(io, 'readStdin')
    const write = functionValue(io, 'write')
    if (!dispatch || !inspect || !readStdin || !write || typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) return undefined
    return Object.freeze({
      fabric: Object.freeze({ dispatch, inspect }),
      io: Object.freeze({
        readStdin,
        write,
        lstat: functionValue(io, 'lstat') ?? lstatSync,
        realpath: functionValue(io, 'realpath') ?? realpathSync,
        stat: functionValue(io, 'stat') ?? statSync,
        open: functionValue(io, 'open') ?? openSync,
        fstat: functionValue(io, 'fstat') ?? fstatSync,
        read: functionValue(io, 'read') ?? readSync,
        close: functionValue(io, 'close') ?? closeSync,
      }),
      repositoryRoot,
    })
  } catch {
    return undefined
  }
}

const emit = (write, value) => {
  try {
    const line = JSON.stringify(value)
    if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_OUTPUT) return false
    write(line)
    return true
  } catch {
    return false
  }
}

const error = (write, code) => {
  emit(write, Object.freeze({ status: 'HELD', error: code }))
  return Object.freeze({ exitCode: 1 })
}

const parseArgs = (rawArgv) => {
  const argv = snapshot(rawArgv)
  if (!Array.isArray(argv) || argv.length !== 3 || typeof argv[0] !== 'string' || !COMMANDS.has(argv[0]) || argv[1] !== '--input' || typeof argv[2] !== 'string') return undefined
  return Object.freeze({ command: argv[0], input: argv[2] })
}

const parseJson = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_INPUT) return undefined
  try {
    return snapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    return undefined
  }
}

const readBoundedStdin = async (value) => {
  if (Buffer.isBuffer(value)) return value.length <= MAX_INPUT ? value : undefined
  if (!value || typeof value[Symbol.asyncIterator] !== 'function') return undefined
  const chunks = []
  let total = 0
  try {
    for await (const chunk of value) {
      if (!Buffer.isBuffer(chunk)) return undefined
      total += chunk.length
      if (total > MAX_INPUT) {
        try { value.destroy?.() } catch {}
        return undefined
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  } catch {
    return undefined
  }
}

const relativeJsonPath = (source) => {
  if (typeof source !== 'string' || source.length === 0 || source.length > 512 || source.includes('\\') || path.isAbsolute(source) || path.win32.isAbsolute(source) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(source) || !source.endsWith('.json')) return undefined
  const segments = source.split('/')
  return segments.length > 0 && segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(segment) && segment !== '.' && segment !== '..') ? segments : undefined
}

const within = (root, candidate) => {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const safeStat = (value, kind) => {
  try {
    return value && typeof value.isSymbolicLink === 'function' && typeof value.isDirectory === 'function' && typeof value.isFile === 'function' &&
      !value.isSymbolicLink() && (kind === 'directory' ? value.isDirectory() : value.isFile())
  } catch {
    return false
  }
}

const identity = (value) => {
  if (!safeStat(value, 'file') || !Number.isSafeInteger(value.size) || value.size < 0 || !['number', 'bigint'].includes(typeof value.dev) || !['number', 'bigint'].includes(typeof value.ino)) return undefined
  return Object.freeze({ dev: String(value.dev), ino: String(value.ino), size: value.size })
}

const sameIdentity = (left, right) => left !== undefined && right !== undefined && left.dev === right.dev && left.ino === right.ino && left.size === right.size

const resolveJsonFile = async (source, capabilities) => {
  const segments = relativeJsonPath(source)
  if (!segments) return undefined
  try {
    const rootStat = await capabilities.io.lstat(capabilities.repositoryRoot)
    if (!safeStat(rootStat, 'directory')) return undefined
    const root = path.resolve(await capabilities.io.realpath(capabilities.repositoryRoot))
    if (!path.isAbsolute(root)) return undefined
    let candidate = root
    for (let index = 0; index < segments.length; index += 1) {
      candidate = path.join(candidate, segments[index])
      const kind = index === segments.length - 1 ? 'file' : 'directory'
      const stat = await capabilities.io.lstat(candidate)
      if (!safeStat(stat, kind)) return undefined
      const resolved = path.resolve(await capabilities.io.realpath(candidate))
      if (!within(root, resolved)) return undefined
      candidate = resolved
    }
    return Object.freeze({ root, file: candidate })
  } catch {
    return undefined
  }
}

const readHandleBounded = async (handle, size, io) => {
  const limit = Math.min(MAX_INPUT + 1, size + 1)
  const buffer = Buffer.alloc(limit)
  let offset = 0
  try {
    while (offset < limit) {
      const result = await io.read(handle, buffer, offset, limit - offset, offset)
      const bytesRead = typeof result === 'number' ? result : result?.bytesRead
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > limit - offset) return undefined
      if (bytesRead === 0) break
      offset += bytesRead
      if (offset > MAX_INPUT) return undefined
    }
    return buffer.subarray(0, offset)
  } catch {
    return undefined
  }
}

const readFileInput = async (source, capabilities) => {
  const before = await resolveJsonFile(source, capabilities)
  if (!before) return undefined
  let handle
  let opened = false
  try {
    handle = await capabilities.io.open(before.file, 'r')
    opened = true
    const openedIdentity = identity(await capabilities.io.fstat(handle))
    const beforeIdentity = identity(await capabilities.io.stat(before.file))
    if (!sameIdentity(openedIdentity, beforeIdentity) || openedIdentity.size > MAX_INPUT) return undefined
    const bytes = await readHandleBounded(handle, openedIdentity.size, capabilities.io)
    if (!bytes || bytes.length !== openedIdentity.size) return undefined
    const afterOpenIdentity = identity(await capabilities.io.fstat(handle))
    const after = await resolveJsonFile(source, capabilities)
    if (!after || after.root !== before.root || after.file !== before.file) return undefined
    const afterIdentity = identity(await capabilities.io.stat(after.file))
    if (!sameIdentity(openedIdentity, afterOpenIdentity) || !sameIdentity(openedIdentity, afterIdentity)) return undefined
    return parseJson(bytes)
  } catch {
    return undefined
  } finally {
    if (opened) {
      try { await capabilities.io.close(handle) } catch {}
    }
  }
}

const readPayload = async (source, capabilities) => {
  if (source === '-') {
    try { return parseJson(await readBoundedStdin(await capabilities.io.readStdin())) } catch { return undefined }
  }
  return readFileInput(source, capabilities)
}

const commandPayload = (command, payload) => {
  if (!isRecord(payload)) return undefined
  if (command === 'inspect') return exactKeys(payload, ['plan_id']) && typeof payload.plan_id === 'string' && PLAN_ID.test(payload.plan_id) ? payload : undefined
  const keys = DISPATCH_KEYS[command]
  if (!keys || !exactKeys(payload, keys) || typeof payload.command_id !== 'string' || !COMMAND_ID.test(payload.command_id) || own(payload, 'type') || own(payload, 'mode')) return undefined
  return payload
}

// A non-null lease snapshot carries the Fabric's authenticated plan-scoped projection
// metadata; the CLI accepts exactly that closed shape and still emits only the oid.
const leaseProjectionValid = (value, planId) => value === undefined || (
  exactKeys(value, ['scope', 'plan_id', 'source_oid', 'source_digest']) && value.scope === 'plan' && value.plan_id === planId &&
  typeof value.source_oid === 'string' && /^[0-9a-f]{40}$/u.test(value.source_oid) &&
  typeof value.source_digest === 'string' && /^[0-9a-f]{64}$/u.test(value.source_digest))

const inspectSuccess = (value, planId) => {
  const result = snapshot(value, MAX_OUTPUT)
  if (!exactKeys(result, ['plan_id', 'plan', 'leases']) || result.plan_id !== planId) return undefined
  for (const key of ['plan', 'leases']) {
    const projected = key === 'leases' && own(result[key], 'projection')
    if (!exactKeys(result[key], projected ? ['oid', 'record', 'projection'] : ['oid', 'record']) || typeof result[key].oid !== 'string' || !/^[0-9a-f]{40}$/u.test(result[key].oid)) return undefined
    if (projected && (result[key].record === null || !leaseProjectionValid(result[key].projection, planId))) return undefined
  }
  return Object.freeze({
    plan_id: result.plan_id,
    plan: Object.freeze({ oid: result.plan.oid }),
    leases: Object.freeze({ oid: result.leases.oid }),
  })
}

const dispatchSuccess = (value, command, type) => {
  const result = snapshot(value, MAX_OUTPUT)
  if (!exactKeys(result, ['command_id', 'type', 'status', 'reason']) || result.command_id !== command.command_id || result.type !== type || !SUCCESS_STATUSES[type]?.has(result.status) || typeof result.reason !== 'string' || !SAFE_REASON.test(result.reason)) return undefined
  return result
}

export async function runParallelDeliveryFabricCli(rawArgv, options = undefined) {
  const capabilities = configured(options)
  const write = capabilities?.io.write ?? (() => {})
  if (!capabilities) return error(write, 'CLI_PORTS_INVALID')
  const args = parseArgs(rawArgv)
  if (!args) return error(write, 'CLI_ARGUMENTS_INVALID')
  const payload = commandPayload(args.command, await readPayload(args.input, capabilities))
  if (!payload) return error(write, 'CLI_INPUT_INVALID')
  let result
  try {
    if (args.command === 'inspect') result = inspectSuccess(await capabilities.fabric.inspect(payload.plan_id), payload.plan_id)
    else result = dispatchSuccess(await capabilities.fabric.dispatch(Object.freeze({ ...payload, type: args.command })), payload, args.command)
  } catch {
    return error(write, 'CLI_FABRIC_UNAVAILABLE')
  }
  if (!result) return error(write, 'CLI_FABRIC_RESULT_UNSUCCESSFUL')
  try {
    const line = JSON.stringify(result)
    if (typeof line !== 'string' || Buffer.byteLength(line, 'utf8') > MAX_OUTPUT) return error(write, 'CLI_OUTPUT_TOO_LARGE')
    write(line)
    return Object.freeze({ exitCode: 0 })
  } catch {
    return error(write, 'CLI_OUTPUT_UNSAFE')
  }
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const io = {
    readStdin: async () => process.stdin,
    write: (line) => process.stdout.write(`${line}\n`),
  }
  let fabric
  try { fabric = await createLocalParallelDeliveryFabric({ repositoryRoot: REPOSITORY_ROOT }) } catch {}
  const unavailable = Object.freeze({
    dispatch: async () => { throw new Error('fabric_unavailable') },
    inspect: async () => { throw new Error('fabric_unavailable') },
  })
  const result = await runParallelDeliveryFabricCli(process.argv.slice(2), { fabric: fabric ?? unavailable, io, repositoryRoot: REPOSITORY_ROOT })
  process.exitCode = result.exitCode
}
