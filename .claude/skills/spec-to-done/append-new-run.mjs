#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  gitInvocationArguments,
  resolveTrustedGit,
  sanitizedGitEnvironment,
} from './trusted-git.mjs'

const APPENDER = fileURLToPath(import.meta.url)
const VALIDATOR = fileURLToPath(new URL('./validate-state.mjs', import.meta.url))
const SCHEMA_VERSION = 'spec-to-done-new-run/v1'
const OWNER_PROVENANCE = 'sha256-tuple-binding-not-digital-signature'
const COMMON_FIELDS = [
  'spec', 'slug', 'userFacing', 'dateStamp', 'branch', 'worktree', 'head', 'executionMode',
  'closeoutTaskIds', 'planPath', 'taskIndex', 'prNumber', 'runIds', 'agentCalls', 'p5Rounds',
  'evidenceAttempts', 'evidenceHead', '診斷', '需要使用者決定',
]
const NEW_RUN_FIELDS = [
  'boundarySchema', 'runSequence', 'newRunId',
  'previousStateSha256', 'previousStateBytes', 'previousCheckpointCount',
  'previousTerminalSha256', 'previousSpec', 'previousSlug', 'previousBranch',
  'previousWorktree', 'previousHead', 'ownerProvenance',
  'gitExecutablePath', 'gitExecutableSha256', 'gitExecutableBytes', 'gitTrustClass',
  'gitDirectory', 'gitCommonDirectory',
  'ownerMessageSha256', 'ownerMessageBytes', 'ownerTupleSha256',
]

class BoundaryError extends Error {
  constructor(held, detail, extra = {}) {
    super(detail)
    this.held = held
    this.extra = extra
  }
}

const reject = (held, detail, extra) => {
  throw new BoundaryError(held, detail, extra)
}
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const portablePath = (value) => path.resolve(value).replace(/\\/g, '/')
const normalizedPath = (value) => {
  const result = portablePath(value).replace(/\/$/, '')
  return process.platform === 'win32' ? result.toLowerCase() : result
}

const parseCli = (argv) => {
  const command = argv.shift()
  if (!['status', 'append'].includes(command)) {
    reject('bad_args', 'first argument must be status or append')
  }
  const values = { command }
  while (argv.length) {
    const key = argv.shift()
    if (!key?.startsWith('--')) reject('bad_args', `invalid argument: ${key || '<empty>'}`)
    const name = key.slice(2)
    if (Object.hasOwn(values, name)) reject('bad_args', `duplicate argument: ${key}`)
    if (name === 'json') {
      values.json = true
      continue
    }
    const value = argv.shift()
    if (value == null || value.startsWith('--')) reject('bad_args', `missing value for ${key}`)
    values[name] = value
  }
  return values
}

const requireExactKeys = (cli, allowed, required) => {
  const unknown = Object.keys(cli).filter((key) => !allowed.has(key))
  const missing = required.filter((key) => !Object.hasOwn(cli, key))
  if (unknown.length || missing.length) {
    reject('bad_args', `unknown or missing arguments: ${[...unknown, ...missing].join(',')}`)
  }
}

const canonicalInteger = (value, name, { positive = false } = {}) => {
  if (!/^(0|[1-9]\d*)$/.test(String(value || ''))) reject('bad_args', `${name} must be canonical integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (positive && number < 1)) reject('bad_args', `${name} is out of range`)
  return number
}

const stateRecords = (buffer) => {
  const text = buffer.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buffer)) reject('resume_state_invalid', 'state must be valid UTF-8')
  const records = []
  let start = 0
  for (let index = 0; index <= buffer.length; index += 1) {
    if (index !== buffer.length && buffer[index] !== 0x0a) continue
    let end = index
    if (end > start && buffer[end - 1] === 0x0d) end -= 1
    const rawLine = buffer.subarray(start, end)
    const line = rawLine.toString('utf8').trim()
    if (line) records.push({ line, rawLine, start })
    start = index + 1
  }
  return records
}

const parseLine = (line) => {
  const segments = line.split('|').map((segment) => segment.trim())
  const prefix = segments.shift()
  const fields = {}
  for (const segment of segments) {
    const separator = segment.indexOf('=')
    if (separator <= 0) reject('resume_state_invalid', `noncanonical state segment: ${segment}`)
    const key = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (Object.hasOwn(fields, key)) reject('resume_state_invalid', `duplicate state key: ${key}`)
    fields[key] = value
  }
  return { prefix, fields }
}

const parseCounter = (value, name, limit) => {
  const match = /^(\d+)\/(\d+)$/.exec(value || '')
  if (!match || Number(match[2]) !== limit || Number(match[1]) > limit) {
    reject('resume_state_invalid', `${name} is not a valid fixed counter`)
  }
  return { used: Number(match[1]), limit }
}

const trustedGit = (gitExe, worktree, held = 'bad_args') => {
  try {
    return resolveTrustedGit(gitExe, worktree)
  } catch (error) {
    reject(held, error.message)
  }
}

const runGit = (gitExe, worktree, args) => spawnSync(
  gitExe,
  gitInvocationArguments(args),
  {
  cwd: worktree, env: sanitizedGitEnvironment(), encoding: 'utf8', windowsHide: true,
  maxBuffer: 1024 * 1024,
  },
)

const gitText = (gitExe, worktree, args, detail) => {
  const result = runGit(gitExe, worktree, args)
  if (result.error || result.status !== 0) reject('resume_state_invalid', detail)
  return result.stdout.trim()
}

const validateTargetGit = (gitExe, worktree, expectedBranch, expectedHead, previousHead) => {
  const top = gitText(gitExe, worktree, ['rev-parse', '--show-toplevel'], 'target is not a Git worktree')
  const rawGitDirectory = gitText(
    gitExe,
    worktree,
    ['rev-parse', '--absolute-git-dir'],
    'target Git directory is unavailable',
  )
  const rawGitCommonDirectory = gitText(
    gitExe,
    worktree,
    ['rev-parse', '--git-common-dir'],
    'target Git common directory is unavailable',
  )
  const gitCommonDirectory = path.isAbsolute(rawGitCommonDirectory)
    ? rawGitCommonDirectory
    : path.resolve(worktree, rawGitCommonDirectory)
  const branch = gitText(gitExe, worktree, ['branch', '--show-current'], 'target branch is detached')
  const head = gitText(gitExe, worktree, ['rev-parse', '--verify', 'HEAD'], 'target HEAD is unavailable').toLowerCase()
  if (normalizedPath(top) !== normalizedPath(worktree) || branch !== expectedBranch ||
      head !== expectedHead.toLowerCase()) {
    reject('resume_state_invalid', 'target worktree branch or HEAD does not match the owner-bound tuple')
  }
  const ancestry = runGit(gitExe, worktree, ['merge-base', '--is-ancestor', previousHead, head])
  if (ancestry.error || ancestry.status !== 0) {
    reject('resume_state_invalid', 'target HEAD is not a descendant of the prior run HEAD')
  }
  const status = gitText(gitExe, worktree, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ], 'could not inspect target cleanliness')
  if (status) reject('resume_state_invalid', 'target worktree must be clean before NEW_RUN migration', { status })
  for (const [label, value] of [
    ['Git directory', rawGitDirectory],
    ['Git common directory', gitCommonDirectory],
  ]) {
    if (!path.isAbsolute(value) || !fs.existsSync(value) || !fs.statSync(value).isDirectory() ||
        fs.lstatSync(value).isSymbolicLink()) {
      reject('resume_state_invalid', `target ${label} is not a canonical plain directory`)
    }
  }
  return {
    branch,
    head,
    gitDirectory: portablePath(fs.realpathSync(rawGitDirectory)),
    gitCommonDirectory: portablePath(fs.realpathSync(gitCommonDirectory)),
  }
}

const assertNoSymlinkPath = (root, target) => {
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    reject('resume_state_invalid', 'target path escapes or equals the worktree root')
  }
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    if (!fs.existsSync(current)) break
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) reject('resume_state_invalid', `symlink/reparse target is forbidden: ${current}`)
  }
}

const inspectSource = (buffer) => {
  if (!buffer.length || buffer.length > 1024 * 1024 || buffer.at(-1) !== 0x0a) {
    reject('resume_state_invalid', 'source state must be non-empty, newline-terminated, and at most 1 MiB')
  }
  const records = stateRecords(buffer)
  if (!records.length || records.length >= 500) reject('resume_state_invalid', 'source checkpoint count is invalid')
  const terminal = parseLine(records.at(-1).line)
  if (!/^HELD@P\d+$/.test(terminal.prefix) || terminal.fields.reason !== 'run_budget_exhausted') {
    reject('resume_state_invalid', 'source must end at HELD reason=run_budget_exhausted')
  }
  const missing = [...COMMON_FIELDS, 'reason'].filter((key) => !Object.hasOwn(terminal.fields, key))
  if (missing.length) reject('resume_state_invalid', `source terminal checkpoint is missing: ${missing.join(',')}`)
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(terminal.fields.slug) ||
      !/^[0-9a-f]{40}$/.test(terminal.fields.head)) {
    reject('resume_state_invalid', 'source slug or prior HEAD is noncanonical')
  }
  const counters = [
    parseCounter(terminal.fields.agentCalls, 'agentCalls', 40),
    parseCounter(terminal.fields.p5Rounds, 'p5Rounds', 2),
    parseCounter(terminal.fields.evidenceAttempts, 'evidenceAttempts', 2),
  ]
  if (!counters.some(({ used, limit }) => used === limit)) {
    reject('resume_state_invalid', 'source has no exactly exhausted fixed counter')
  }
  if (!['true', 'false'].includes(terminal.fields.userFacing) ||
      !['full', 'evidence-closeout'].includes(terminal.fields.executionMode)) {
    reject('resume_state_invalid', 'source execution identity is invalid')
  }
  return {
    records, terminal,
    terminalSha256: sha256(records.at(-1).rawLine),
    runSequence: records.filter(({ line }) => line.startsWith('NEW_RUN@P0 |')).length + 2,
  }
}

const newRunSeed = (fields) => ({
  boundarySchema: fields.boundarySchema,
  runSequence: Number(fields.runSequence),
  previousStateSha256: fields.previousStateSha256,
  previousStateBytes: Number(fields.previousStateBytes),
  previousCheckpointCount: Number(fields.previousCheckpointCount),
  previousTerminalSha256: fields.previousTerminalSha256,
  previousSpec: fields.previousSpec, previousSlug: fields.previousSlug,
  previousBranch: fields.previousBranch, previousWorktree: fields.previousWorktree,
  previousHead: fields.previousHead,
  gitExecutablePath: fields.gitExecutablePath,
  gitExecutableSha256: fields.gitExecutableSha256,
  gitExecutableBytes: Number(fields.gitExecutableBytes),
  gitTrustClass: fields.gitTrustClass,
  gitDirectory: fields.gitDirectory,
  gitCommonDirectory: fields.gitCommonDirectory,
  spec: fields.spec, slug: fields.slug, userFacing: fields.userFacing,
  branch: fields.branch, worktree: fields.worktree, head: fields.head,
  executionMode: fields.executionMode, closeoutTaskIds: fields.closeoutTaskIds,
  dateStamp: fields.dateStamp,
  ownerMessageSha256: fields.ownerMessageSha256,
  ownerMessageBytes: Number(fields.ownerMessageBytes),
})

const finishBoundaryIdentity = (fields) => {
  const digest = sha256(JSON.stringify(newRunSeed(fields)))
  fields.newRunId = `run-${fields.runSequence}-${digest.slice(0, 16)}`
  fields.ownerTupleSha256 = sha256(JSON.stringify({
    ...newRunSeed(fields), newRunId: fields.newRunId,
    ownerProvenance: fields.ownerProvenance,
  }))
  return fields
}

const buildBoundaryFields = (
  cli,
  sourceBuffer,
  sourceInfo,
  targetWorktree,
  gitIdentity,
  gitTrust,
) => {
  if (!/^[0-9a-f]{64}$/.test(cli['owner-message-sha256']) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(cli['date-stamp'])) {
    reject('bad_args', 'owner SHA-256 or date stamp is invalid')
  }
  const ownerBytes = canonicalInteger(cli['owner-message-bytes'], 'owner-message-bytes', { positive: true })
  const old = sourceInfo.terminal.fields
  const expectedSpec = path.join('openspec', 'changes', old.slug)
  if (normalizedPath(path.relative(old.worktree, old.spec)) !== normalizedPath(expectedSpec)) {
    reject('resume_state_invalid', 'source spec is not the canonical OpenSpec change path')
  }
  const spec = path.join(targetWorktree, expectedSpec)
  if (!fs.existsSync(spec) || !fs.statSync(spec).isDirectory()) {
    reject('resume_state_invalid', 'target worktree does not contain the same OpenSpec change')
  }
  const fields = {
    spec: portablePath(spec), slug: old.slug, userFacing: old.userFacing,
    dateStamp: cli['date-stamp'], branch: gitIdentity.branch,
    worktree: portablePath(targetWorktree), head: gitIdentity.head,
    executionMode: old.executionMode, closeoutTaskIds: old.closeoutTaskIds,
    planPath: '', taskIndex: '0', prNumber: '', runIds: 'none',
    agentCalls: '0/40', p5Rounds: '0/2', evidenceAttempts: '0/2', evidenceHead: '',
    '診斷': 'owner-authorized-new-run-boundary', '需要使用者決定': 'none',
    boundarySchema: SCHEMA_VERSION, runSequence: String(sourceInfo.runSequence), newRunId: '',
    previousStateSha256: sha256(sourceBuffer), previousStateBytes: String(sourceBuffer.length),
    previousCheckpointCount: String(sourceInfo.records.length),
    previousTerminalSha256: sourceInfo.terminalSha256,
    previousSpec: old.spec, previousSlug: old.slug, previousBranch: old.branch,
    previousWorktree: old.worktree, previousHead: old.head,
    ownerProvenance: OWNER_PROVENANCE,
    gitExecutablePath: portablePath(gitTrust.resolvedGit),
    gitExecutableSha256: gitTrust.executableSha256,
    gitExecutableBytes: String(gitTrust.executableBytes),
    gitTrustClass: gitTrust.trustClass,
    gitDirectory: gitIdentity.gitDirectory,
    gitCommonDirectory: gitIdentity.gitCommonDirectory,
    ownerMessageSha256: cli['owner-message-sha256'], ownerMessageBytes: String(ownerBytes),
    ownerTupleSha256: '',
  }
  for (const [key, value] of Object.entries(fields)) {
    if (/[|\r\n]/.test(value)) reject('resume_state_invalid', `NEW_RUN field contains a forbidden delimiter: ${key}`)
  }
  return finishBoundaryIdentity(fields)
}

const canonicalBoundaryLine = (fields) => `NEW_RUN@P0 | ${[
  ...COMMON_FIELDS, ...NEW_RUN_FIELDS,
].map((key) => `${key}=${fields[key]}`).join(' | ')}`

const atomicReplace = (target, buffer) => {
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let handle
  try {
    handle = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(handle, buffer)
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = null
    fs.renameSync(temporary, target)
  } finally {
    if (handle != null) fs.closeSync(handle)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}

const validateWrittenState = (target, worktree, gitExe, head) => {
  const result = spawnSync(process.execPath, [
    VALIDATOR, '--state', target, '--platform', 'codex',
    '--git-exe', gitExe, '--expected-head', head,
    '--expected-worktree', worktree,
    '--expected-agent-limit', '40', '--expected-p5-limit', '2',
    '--expected-evidence-limit', '2', '--trusted-main-ref', 'refs/heads/main',
  ], {
    cwd: worktree, env: sanitizedGitEnvironment(), encoding: 'utf8', windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  let output
  try { output = JSON.parse(result.stdout) } catch { output = null }
  if (result.error || result.status !== 0 || output?.ok !== true) {
    reject('resume_state_invalid', `post-write validator rejected NEW_RUN: ${output?.detail || 'invalid output'}`)
  }
  return output
}

const statusCommand = (cli) => {
  requireExactKeys(cli, new Set(['command', 'state', 'json']), ['state', 'json'])
  if (!path.isAbsolute(cli.state) || !fs.existsSync(cli.state) || !fs.statSync(cli.state).isFile()) {
    reject('bad_args', '--state must be an existing absolute file')
  }
  const buffer = fs.readFileSync(cli.state)
  const records = stateRecords(buffer)
  if (!records.length) reject('resume_state_invalid', 'state has no checkpoints')
  const terminal = parseLine(records.at(-1).line)
  let exhausted = false
  if (terminal.prefix.startsWith('HELD@') && terminal.fields.reason === 'run_budget_exhausted') {
    const counters = [
      parseCounter(terminal.fields.agentCalls, 'agentCalls', 40),
      parseCounter(terminal.fields.p5Rounds, 'p5Rounds', 2),
      parseCounter(terminal.fields.evidenceAttempts, 'evidenceAttempts', 2),
    ]
    exhausted = counters.some(({ used, limit }) => used === limit)
  }
  return {
    ok: true, state: portablePath(cli.state), bytes: buffer.length, sha256: sha256(buffer),
    checkpoints: records.length,
    runSequence: records.filter(({ line }) => line.startsWith('NEW_RUN@P0 |')).length + 1,
    terminal: terminal.prefix, reason: terminal.fields.reason || '',
    canStartNewRun: exhausted, ownerAuthorizationRequired: exhausted,
    nextAction: exhausted
      ? 'obtain-exact-owner-authorization-then-run-append'
      : 'continue-or-hold-current-run-without-counter-reset',
    appendRequiredArguments: exhausted ? [
      'source-state', 'target-worktree', 'git-exe', 'expected-branch', 'expected-head',
      'expected-source-sha256', 'expected-source-bytes', 'expected-source-checkpoints',
      'owner-message-sha256', 'owner-message-bytes', 'date-stamp', 'json',
    ] : [],
  }
}

const readAuthorizedSource = (cli) => {
  if (fs.lstatSync(cli['source-state']).isSymbolicLink()) {
    reject('resume_state_invalid', 'source state symlink is forbidden')
  }
  const sourceBuffer = fs.readFileSync(cli['source-state'])
  const sourceInfo = inspectSource(sourceBuffer)
  const expectedBytes = canonicalInteger(cli['expected-source-bytes'], 'expected-source-bytes', { positive: true })
  const expectedCheckpoints = canonicalInteger(
    cli['expected-source-checkpoints'], 'expected-source-checkpoints', { positive: true },
  )
  if (sourceBuffer.length !== expectedBytes || sha256(sourceBuffer) !== cli['expected-source-sha256'] ||
      sourceInfo.records.length !== expectedCheckpoints) {
    reject('resume_state_invalid', 'source state drifted from the exact owner-authorized tuple')
  }
  return { sourceBuffer, sourceInfo }
}

export const appendCommand = (cli, hooks = {}) => {
  const required = [
    'source-state', 'target-worktree', 'git-exe', 'expected-branch', 'expected-head',
    'expected-source-sha256', 'expected-source-bytes', 'expected-source-checkpoints',
    'owner-message-sha256', 'owner-message-bytes', 'date-stamp', 'json',
  ]
  requireExactKeys(cli, new Set(['command', ...required]), required)
  if (!path.isAbsolute(cli['source-state']) || !path.isAbsolute(cli['target-worktree']) ||
      !fs.existsSync(cli['source-state']) || !fs.statSync(cli['source-state']).isFile() ||
      !fs.existsSync(cli['target-worktree']) || !fs.statSync(cli['target-worktree']).isDirectory()) {
    reject('bad_args', 'source state and target worktree must be existing absolute paths')
  }
  if (!/^[0-9a-f]{40}$/.test(cli['expected-head']) ||
      !/^[0-9a-f]{64}$/.test(cli['expected-source-sha256']) ||
      /[|\r\n]/.test(cli['expected-branch'])) {
    reject('bad_args', 'expected Git or source identity is invalid')
  }
  const initialSource = readAuthorizedSource(cli)
  const initialTrust = trustedGit(cli['git-exe'], cli['target-worktree'])
  if (initialTrust.trustClass !== 'system-owned-read-only') {
    reject('host_env_blocked', 'NEW_RUN append requires an approved system-owned, read-only Git executable')
  }
  const targetWorktree = initialTrust.resolvedWorktree
  const target = path.join(
    targetWorktree,
    'artifacts',
    'spec-to-done',
    `${initialSource.sourceInfo.terminal.fields.slug}-state.md`,
  )
  assertNoSymlinkPath(targetWorktree, path.dirname(target))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  assertNoSymlinkPath(targetWorktree, path.dirname(target))
  const lockPath = `${target}.new-run.lock`
  let lock
  let wrote = false
  let lockIdentity
  let priorTargetBuffer = null
  let candidate = null
  let fields = null
  let sourceBuffer = null
  try {
    if (typeof hooks.beforeLock === 'function') hooks.beforeLock({ lockPath, target })
    try {
      lock = fs.openSync(lockPath, 'wx', 0o600)
      lockIdentity = fs.fstatSync(lock)
    } catch (error) {
      reject('resume_state_invalid', `NEW_RUN lock is unavailable: ${error.code || error.message}`)
    }

    const lockedTrust = trustedGit(cli['git-exe'], cli['target-worktree'], 'resume_state_invalid')
    if (normalizedPath(lockedTrust.resolvedGit) !== normalizedPath(initialTrust.resolvedGit) ||
        normalizedPath(lockedTrust.resolvedWorktree) !== normalizedPath(initialTrust.resolvedWorktree) ||
        lockedTrust.executableSha256 !== initialTrust.executableSha256 ||
        lockedTrust.executableBytes !== initialTrust.executableBytes ||
        lockedTrust.trustClass !== initialTrust.trustClass) {
      reject('resume_state_invalid', 'trusted Git or target worktree identity changed while acquiring NEW_RUN lock')
    }

    const lockedSource = readAuthorizedSource(cli)
    sourceBuffer = lockedSource.sourceBuffer
    assertNoSymlinkPath(targetWorktree, target)
    if (fs.existsSync(target)) {
      const targetStat = fs.lstatSync(target)
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        reject('resume_state_invalid', 'canonical target state is not a plain file')
      }
      priorTargetBuffer = fs.readFileSync(target)
    }

    const gitIdentity = validateTargetGit(
      lockedTrust.resolvedGit,
      targetWorktree,
      cli['expected-branch'],
      cli['expected-head'],
      lockedSource.sourceInfo.terminal.fields.head,
    )
    fields = buildBoundaryFields(
      cli,
      sourceBuffer,
      lockedSource.sourceInfo,
      targetWorktree,
      gitIdentity,
      lockedTrust,
    )
    const newline = sourceBuffer.length >= 2 && sourceBuffer.subarray(-2).equals(Buffer.from('\r\n'))
      ? '\r\n' : '\n'
    const boundaryLine = canonicalBoundaryLine(fields)
    candidate = Buffer.concat([sourceBuffer, Buffer.from(`${boundaryLine}${newline}`, 'utf8')])
    if (priorTargetBuffer?.equals(candidate)) {
      reject('resume_state_invalid', 'target already contains the completed NEW_RUN boundary; repeat refused')
    }
    if (priorTargetBuffer != null && !priorTargetBuffer.equals(sourceBuffer)) {
      reject('resume_state_invalid', 'target already differs from the exact source; overwrite refused')
    }

    atomicReplace(target, candidate)
    wrote = true
    if (typeof hooks.afterWrite === 'function') hooks.afterWrite({ target })
    if (!fs.readFileSync(target).equals(candidate)) reject('resume_state_invalid', 'NEW_RUN atomic readback mismatch')
    validateWrittenState(target, targetWorktree, lockedTrust.resolvedGit, gitIdentity.head)
  } catch (error) {
    if (wrote) {
      if (priorTargetBuffer != null) {
        atomicReplace(target, priorTargetBuffer)
      } else if (fs.existsSync(target)) {
        const current = fs.readFileSync(target)
        if (!candidate || !current.equals(candidate)) {
          reject('resume_state_invalid', 'NEW_RUN rollback refused because target changed after write')
        }
        fs.unlinkSync(target)
      }
    }
    throw error
  } finally {
    if (lock != null) fs.closeSync(lock)
    if (lockIdentity && fs.existsSync(lockPath)) {
      const currentLock = fs.lstatSync(lockPath)
      if (currentLock.dev === lockIdentity.dev && currentLock.ino === lockIdentity.ino) {
        fs.unlinkSync(lockPath)
      }
    }
  }
  return {
    ok: true, state: portablePath(target), sourceSha256: sha256(sourceBuffer),
    sourceBytes: sourceBuffer.length, previousHead: fields.previousHead,
    head: fields.head, runSequence: Number(fields.runSequence), newRunId: fields.newRunId,
    ownerProvenance: fields.ownerProvenance, ownerTupleSha256: fields.ownerTupleSha256,
  }
}

if (process.argv[1] && normalizedPath(process.argv[1]) === normalizedPath(APPENDER)) {
  try {
    const cli = parseCli(process.argv.slice(2))
    const result = cli.command === 'status' ? statusCommand(cli) : appendCommand(cli)
    process.stdout.write(JSON.stringify(result))
  } catch (error) {
    const held = error instanceof BoundaryError ? error.held : 'resume_state_invalid'
    const detail = error instanceof Error ? error.message : String(error)
    const extra = error instanceof BoundaryError ? error.extra : {}
    process.stdout.write(JSON.stringify({ ok: false, held, detail, ...extra }))
    process.exitCode = 2
  }
}
