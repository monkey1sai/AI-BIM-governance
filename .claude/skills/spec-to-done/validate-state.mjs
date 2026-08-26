#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const MACHINE_CONTRACT_URL = new URL('../../../agent-contracts/spec-to-done.contract.json', import.meta.url)
const STATE_PREFIX = /^(HELD|DONE|RESUMED|AUTHORIZATION|NEW_RUN)@(P\d+)$/
const MAX_AGENT_CALLS = 40
const MAX_P5_ROUNDS = 2
const MAX_EVIDENCE_ATTEMPTS = 2
const CONTRACT_V1_PHASES = ['P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7']
const CONTRACT_V1_TERMINAL_EVIDENCE = {
  owner_phase: 'P7',
  trusted_remote_url: 'https://github.com/monkey1sai/AI-BIM-governance.git',
  remote_main_ref: 'refs/heads/main',
  live_remote_resolution: 'required',
  pr_head_ancestor_of_merge_commit: 'required',
  merge_commit_equals_remote_main: 'required',
  pr_head_and_merge_commit_same_tree: 'required',
}
const CONTRACT_V1_NEW_RUN_BOUNDARY = {
  schema_version: 'spec-to-done-new-run/v1',
  token: 'NEW_RUN@P0',
  required_previous_reason: 'run_budget_exhausted',
  owner_provenance: 'sha256-tuple-binding-not-digital-signature',
  counter_resets: { agentCalls: '0/40', p5Rounds: '0/2', evidenceAttempts: '0/2' },
  field_resets: { planPath: '', taskIndex: '0', prNumber: '', runIds: 'none', evidenceHead: '' },
}
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
  'ownerMessageSha256', 'ownerMessageBytes', 'ownerTupleSha256',
]
const AUTH_SCOPES = new Set(['impact-signoff', 'detect-signoff', 'review-signoff', 'repo-workflow-signoff'])
const REQUIRED_AUTH_EXCLUSIONS = new Set([
  'secrets', 'credentials', 'billing', 'production-data', 'destructive-delete', 'unproven-process-stop',
])
const ALLOWED_PHASE_TRANSITIONS = new Set([
  'P0>P0', 'P0>P1',
  'P1>P1', 'P1>P3',
  'P3>P3', 'P3>P4', 'P3>P5',
  'P4>P4', 'P4>P5',
  'P5>P3', 'P5>P4', 'P5>P5', 'P5>P6',
  'P6>P3', 'P6>P4', 'P6>P5', 'P6>P6', 'P6>P7',
  'P7>P7',
])
let TRUSTED_GIT_EXE = null
let ALLOWED_PHASES = null
let ALLOWED_HELD_REASONS = null
let TERMINAL_EVIDENCE = null
let NEW_RUN_BOUNDARY = null
const NON_RESUMABLE_HELD_REASONS = new Set([
  'branch_requires_separate_authorization',
  'trusted_elevated_authorization_unavailable',
])

class ContractError extends Error {
  constructor(held, detail, extra = {}) {
    super(detail)
    this.held = held
    this.extra = extra
  }
}

const reject = (held, detail, extra) => {
  throw new ContractError(held, detail, extra)
}

const loadMachineContract = () => {
  let contract
  try {
    contract = JSON.parse(fs.readFileSync(MACHINE_CONTRACT_URL, 'utf8'))
  } catch (error) {
    reject('resume_state_invalid', `could not load the spec-to-done machine contract: ${error.message}`)
  }
  const durableState = contract && typeof contract === 'object' ? contract.durable_state : null
  const phases = contract && contract.phases
  const reasons = durableState && durableState.held_reasons
  const newRunBoundary = durableState && durableState.new_run_boundary
  const terminalEvidence = contract && contract.terminal_evidence
  if (
    !contract || typeof contract !== 'object' ||
    contract.schema_version !== 'spec-to-done-contract/v1' ||
    !durableState || durableState.canonical_relative_path !== 'artifacts/spec-to-done/{slug}-state.md' ||
    !Array.isArray(phases) || JSON.stringify(phases) !== JSON.stringify(CONTRACT_V1_PHASES) ||
    !Array.isArray(reasons) || reasons.length === 0 || new Set(reasons).size !== reasons.length ||
    reasons.some((reason) => !/^[a-z][a-z0-9_]*$/.test(reason)) ||
    JSON.stringify(newRunBoundary) !== JSON.stringify(CONTRACT_V1_NEW_RUN_BOUNDARY) ||
    !terminalEvidence ||
    JSON.stringify(terminalEvidence) !== JSON.stringify(CONTRACT_V1_TERMINAL_EVIDENCE)
  ) {
    reject('resume_state_invalid', 'spec-to-done machine contract is malformed')
  }
  ALLOWED_PHASES = new Set(phases)
  ALLOWED_HELD_REASONS = new Set(reasons)
  TERMINAL_EVIDENCE = terminalEvidence
  NEW_RUN_BOUNDARY = newRunBoundary
}

const parseCli = (argv) => {
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key || !key.startsWith('--') || value == null) {
      reject('resume_state_invalid', 'arguments must be --key value pairs')
    }
    const name = key.slice(2)
    if (Object.hasOwn(result, name)) reject('resume_state_invalid', `duplicate validator argument: ${key}`)
    result[name] = value
  }
  return result
}

const parsePositiveInteger = (value, name) => {
  if (!/^\d+$/.test(String(value || ''))) {
    reject('resume_state_invalid', `${name} must be a non-negative integer`)
  }
  return Number(value)
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

const parseExactInteger = (value, name) => {
  if (!/^(0|[1-9]\d*)$/.test(String(value || ''))) {
    reject('resume_state_invalid', `${name} must be a canonical non-negative integer`)
  }
  return Number(value)
}

const newRunSeed = (fields) => ({
  boundarySchema: fields.boundarySchema,
  runSequence: parseExactInteger(fields.runSequence, 'runSequence'),
  previousStateSha256: fields.previousStateSha256,
  previousStateBytes: parseExactInteger(fields.previousStateBytes, 'previousStateBytes'),
  previousCheckpointCount: parseExactInteger(fields.previousCheckpointCount, 'previousCheckpointCount'),
  previousTerminalSha256: fields.previousTerminalSha256,
  previousSpec: fields.previousSpec,
  previousSlug: fields.previousSlug,
  previousBranch: fields.previousBranch,
  previousWorktree: fields.previousWorktree,
  previousHead: fields.previousHead,
  spec: fields.spec, slug: fields.slug, userFacing: fields.userFacing,
  branch: fields.branch, worktree: fields.worktree, head: fields.head,
  executionMode: fields.executionMode, closeoutTaskIds: fields.closeoutTaskIds,
  dateStamp: fields.dateStamp,
  ownerMessageSha256: fields.ownerMessageSha256,
  ownerMessageBytes: parseExactInteger(fields.ownerMessageBytes, 'ownerMessageBytes'),
})

const expectedNewRunId = (fields) => {
  const digest = sha256(JSON.stringify(newRunSeed(fields)))
  return `run-${fields.runSequence}-${digest.slice(0, 16)}`
}

const expectedOwnerTupleSha256 = (fields) => sha256(JSON.stringify({
  ...newRunSeed(fields),
  newRunId: fields.newRunId,
  ownerProvenance: fields.ownerProvenance,
}))

const canonicalNewRunLine = (fields) => `NEW_RUN@P0 | ${[
  ...COMMON_FIELDS,
  ...NEW_RUN_FIELDS,
].map((key) => `${key}=${fields[key]}`).join(' | ')}`

const parseCounter = (raw, name, expectedLimit) => {
  const match = /^(\d+)\/(\d+)$/.exec(raw || '')
  if (!match) reject('resume_state_invalid', `${name} must use used/limit syntax`)
  const used = Number(match[1])
  const limit = Number(match[2])
  if (limit !== expectedLimit) {
    reject('resume_state_invalid', `${name} limit changed silently: expected ${expectedLimit}, got ${limit}`)
  }
  if (used > limit) {
    reject('run_budget_exhausted', `${name} exhausted: ${used}/${limit}`, { counter: name, used, limit })
  }
  return { used, limit }
}

const parseFields = (segments) => {
  const fields = {}
  for (const segment of segments) {
    const separator = segment.indexOf('=')
    if (separator <= 0) reject('resume_state_invalid', `state segment is not key=value: ${segment}`)
    const key = segment.slice(0, separator).trim()
    const value = segment.slice(separator + 1).trim()
    if (Object.hasOwn(fields, key)) reject('resume_state_invalid', `duplicate state key: ${key}`)
    fields[key] = value
  }
  for (const alias of ['diagnosis', 'need', 'stateSchema']) {
    if (Object.hasOwn(fields, alias)) reject('resume_state_invalid', `noncanonical state key: ${alias}`)
  }
  return fields
}

const stateRecords = (buffer) => {
  const text = buffer.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buffer)) {
    reject('resume_state_invalid', 'state file must be valid UTF-8')
  }
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

const requireFields = (fields, required) => {
  const missing = required.filter((key) => !Object.hasOwn(fields, key))
  if (missing.length) reject('resume_state_invalid', `missing state fields: ${missing.join(',')}`, { missing })
}

const extractRunIds = (runIds) => ({
  claude: new Set(String(runIds || '').match(/\bwf_[A-Za-z0-9_-]+\b/g) || []),
  codex: new Set(String(runIds || '').match(/codex:[A-Za-z0-9][A-Za-z0-9._:-]{7,}/g) || []),
  grok: new Set(String(runIds || '').match(/grok:[A-Za-z0-9][A-Za-z0-9._:-]{7,}/g) || []),
})

const validateRunIds = (runIds, platform, phase, executionMode) => {
  if (/native[-_:]/i.test(runIds)) {
    reject('resume_state_invalid', 'descriptive native-* labels are not resumable run IDs')
  }
  const canBeNone = phase === 'P0' || (phase === 'P1' && executionMode === 'evidence-closeout')
  if (runIds === 'none' && canBeNone) return
  const ids = extractRunIds(runIds)
  if (platform === null && ids.claude.size === 0 && ids.codex.size === 0 && ids.grok.size === 0) {
    reject('resume_state_invalid', 'historical state must contain an actual wf_*, codex:*, or grok:* run ID')
  }
  if (platform === 'claude' && ids.claude.size === 0) {
    reject('resume_state_invalid', 'Claude state must contain an actual wf_* run ID')
  }
  if (platform === 'codex' && ids.codex.size === 0) {
    reject('resume_state_invalid', 'Codex state must contain codex:<actual-session-or-agent-id>')
  }
  if (platform === 'grok' && ids.grok.size === 0) {
    reject('resume_state_invalid', 'Grok state must contain grok:<actual-subagent-or-workflow-id>')
  }
}

const normalizedPath = (value) => {
  const normalized = path.resolve(String(value || '')).replace(/\\/g, '/').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
const isWithinPath = (value, root) => {
  const target = normalizedPath(value)
  const base = normalizedPath(root)
  return target === base || target.startsWith(`${base}/`)
}
const relativeToWorktree = (value, worktree) => {
  const target = normalizedPath(value)
  const root = normalizedPath(worktree)
  return target.startsWith(`${root}/`) ? target.slice(root.length + 1) : null
}
const normalizeRepoPath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/')) return null
  const parts = normalized.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  return normalized
}
const isEvidenceOnlyPath = (value, fields) => {
  const normalized = normalizeRepoPath(value)
  if (!normalized) return false
  const file = normalized.toLowerCase()
  if (file.startsWith('docs/evidence/') || file.startsWith('artifacts/e2e/')) return true
  if (!/^openspec\/changes\/[^/]+\/tasks\.md$/.test(file)) return false
  const specChange = relativeToWorktree(fields.spec, fields.worktree)
  const change = specChange && /^openspec\/changes\/[^/]+$/.test(specChange.toLowerCase())
    ? specChange
    : (fields.executionMode === 'full' ? `openspec/changes/${fields.slug}` : null)
  return Boolean(
    change &&
    /^openspec\/changes\/[^/]+$/.test(change.toLowerCase()) &&
    file === `${change.toLowerCase()}/tasks.md`,
  )
}

const validateTrustedGit = (gitExe, expectedWorktree) => {
  if (!path.isAbsolute(gitExe || '') || !fs.existsSync(gitExe)) {
    reject('resume_state_invalid', '--git-exe must name an existing absolute Git executable')
  }
  if (!fs.existsSync(expectedWorktree) || !fs.statSync(expectedWorktree).isDirectory()) {
    reject('resume_state_invalid', `expected worktree is not a directory: ${expectedWorktree}`)
  }
  const resolvedGit = fs.realpathSync(gitExe)
  const resolvedWorktree = fs.realpathSync(expectedWorktree)
  if (!['git', 'git.exe'].includes(path.basename(resolvedGit).toLowerCase())) {
    reject('resume_state_invalid', '--git-exe basename must be git or git.exe')
  }
  if (isWithinPath(resolvedGit, resolvedWorktree)) {
    reject('resume_state_invalid', '--git-exe must resolve outside the governed worktree')
  }
  return { resolvedGit, resolvedWorktree }
}

const runGit = (worktree, gitArgs) => spawnSync(TRUSTED_GIT_EXE, gitArgs, {
  cwd: worktree,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 1024 * 1024,
})

const sanitizedRemoteGitEnvironment = () => {
  const env = { ...process.env }
  const unsafeExactKeys = new Set([
    'CURL_CA_BUNDLE',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ])
  for (const key of Object.keys(env)) {
    const normalizedKey = key.toUpperCase()
    if (normalizedKey.startsWith('GIT_') || unsafeExactKeys.has(normalizedKey)) delete env[key]
  }
  const gitDirectory = path.dirname(TRUSTED_GIT_EXE)
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_SYSTEM = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CEILING_DIRECTORIES = gitDirectory
  env.GIT_DISCOVERY_ACROSS_FILESYSTEM = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

const resolveTrustedRemoteMain = () => {
  const gitDirectory = path.dirname(TRUSTED_GIT_EXE)
  const result = spawnSync(TRUSTED_GIT_EXE, [
    '-c', 'http.sslVerify=true',
    'ls-remote', '--exit-code', '--refs',
    TERMINAL_EVIDENCE.trusted_remote_url,
    TERMINAL_EVIDENCE.remote_main_ref,
  ], {
    cwd: gitDirectory,
    env: sanitizedRemoteGitEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024,
  })
  if (result.error || result.status !== 0) {
    reject('evidence_stale', `could not resolve live remote ${TERMINAL_EVIDENCE.remote_main_ref} from the fixed trusted remote`)
  }
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 1) {
    reject('evidence_stale', 'live trusted remote resolution returned malformed or multiple refs')
  }
  const match = /^([0-9a-f]{40})\t(refs\/heads\/main)$/i.exec(lines[0])
  if (!match || match[2] !== TERMINAL_EVIDENCE.remote_main_ref) {
    reject('evidence_stale', 'live trusted remote resolution did not return the exact remote main ref')
  }
  return match[1].toLowerCase()
}

const gitPathList = (fields, gitArgs, held, detail) => {
  const result = runGit(fields.worktree, gitArgs)
  if (result.error || result.status !== 0) reject(held, detail)
  return result.stdout.split('\0').filter(Boolean)
}

const productionFilesFrom = (files, fields) => [
  ...new Set(files.filter((file) => !isEvidenceOnlyPath(file, fields))),
]

const validateActualHead = (fields, expectedHead) => {
  const actual = runGit(fields.worktree, ['rev-parse', '--verify', 'HEAD'])
  if (actual.error || actual.status !== 0) {
    reject('resume_state_invalid', 'could not resolve the actual worktree HEAD with the trusted Git executable')
  }
  const actualHead = actual.stdout.trim().toLowerCase()
  if (actualHead !== fields.head.toLowerCase() || actualHead !== expectedHead.toLowerCase()) {
    reject('evidence_stale', `actual worktree HEAD ${actualHead || '<empty>'} does not match state/expected HEAD`)
  }
}

const validateActualBranch = (fields) => {
  const actual = runGit(fields.worktree, ['branch', '--show-current'])
  if (actual.error || actual.status !== 0 || !actual.stdout.trim() ||
      actual.stdout.trim() !== fields.branch) {
    reject('resume_state_invalid', 'NEW_RUN branch does not match the attached target worktree')
  }
}

const validateWorkingTree = (fields) => {
  const paths = [
    ...gitPathList(fields, ['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', '--'], 'resume_state_invalid', 'could not inspect unstaged worktree changes'),
    ...gitPathList(fields, ['diff', '--cached', '--name-only', '--no-renames', '--no-ext-diff', '-z', '--'], 'resume_state_invalid', 'could not inspect staged worktree changes'),
    ...gitPathList(fields, ['ls-files', '--others', '--exclude-standard', '-z'], 'resume_state_invalid', 'could not inspect untracked worktree files'),
  ]
  const productionFiles = productionFilesFrom(paths, fields)
  if (productionFiles.length) {
    const held = fields.evidenceHead ? 'evidence_stale' : 'resume_state_invalid'
    const detail = fields.evidenceHead
      ? 'production files changed after evidence was captured'
      : 'production files are dirty while reconstructing resumable state'
    reject(held, detail, { productionFiles })
  }
}

const validateEvidenceAncestry = (fields, subjectHead = fields.head) => {
  const ancestor = runGit(fields.worktree, ['merge-base', '--is-ancestor', fields.evidenceHead, subjectHead])
  if (ancestor.error || ancestor.status !== 0) {
    reject('evidence_stale', `evidence HEAD ${fields.evidenceHead} is not a proven ancestor of ${subjectHead}`)
  }
  const changedFiles = gitPathList(
    fields,
    ['diff', '--name-only', '--no-renames', '--no-ext-diff', '-z', `${fields.evidenceHead}..${subjectHead}`, '--'],
    'evidence_stale',
    'could not prove the evidence-to-state diff is evidence-only',
  )
  const productionFiles = productionFilesFrom(changedFiles, fields)
  if (productionFiles.length) {
    reject('evidence_stale', 'production files changed after evidence was captured', { productionFiles })
  }
}

const validateTerminalP7 = (fields) => {
  validateEvidenceAncestry(fields, fields.prHead)
  const ancestor = runGit(fields.worktree, ['merge-base', '--is-ancestor', fields.prHead, fields.mergeCommit])
  if (ancestor.error || ancestor.status !== 0) {
    reject('evidence_stale', 'P7 merge commit is not a proven descendant of the independently evidenced PR head')
  }
  const remoteMain = resolveTrustedRemoteMain()
  if (remoteMain !== fields.mergeCommit.toLowerCase()) {
    reject('evidence_stale', `P7 merge commit does not equal live remote ${TERMINAL_EVIDENCE.remote_main_ref}`)
  }
  const sameTree = runGit(fields.worktree, ['diff', '--quiet', '--no-ext-diff', fields.prHead, fields.mergeCommit, '--'])
  if (sameTree.error || sameTree.status !== 0) {
    reject('evidence_stale', 'P7 merge commit tree differs from the independently evidenced PR head')
  }
}

const validateAuthorization = (fields) => {
  if (fields.decision !== 'delegate-repo-workflow-signoff') {
    reject('resume_state_invalid', 'AUTHORIZATION decision is outside the allowlist')
  }
  const scopes = fields.scope.split(',').map((value) => value.trim()).filter(Boolean)
  if (!scopes.length || scopes.some((scope) => !AUTH_SCOPES.has(scope)) || new Set(scopes).size !== scopes.length) {
    reject('resume_state_invalid', 'AUTHORIZATION scope is outside the allowlist')
  }
  const exclusions = fields.exclusions.split(',').map((value) => value.trim()).filter(Boolean)
  const exclusionSet = new Set(exclusions)
  if (exclusionSet.size !== exclusions.length || exclusions.some((value) => !REQUIRED_AUTH_EXCLUSIONS.has(value)) ||
      [...REQUIRED_AUTH_EXCLUSIONS].some((value) => !exclusionSet.has(value))) {
    reject('resume_state_invalid', 'AUTHORIZATION exclusions must equal the permanent exclusion allowlist')
  }
}

const parseStateLine = (line) => {
  if (/\bP2\b/.test(line)) reject('resume_state_invalid', 'P2 is not a valid spec-to-done phase')
  const segments = line.split('|').map((segment) => segment.trim())
  const prefix = segments.shift()
  const prefixMatch = STATE_PREFIX.exec(prefix)
  if (!prefixMatch) reject('resume_state_invalid', `noncanonical state prefix: ${prefix}`)
  const [, kind, phase] = prefixMatch
  if (!ALLOWED_PHASES.has(phase)) reject('resume_state_invalid', `invalid phase: ${phase}`)
  return { kind, phase, fields: parseFields(segments) }
}

const parseOptionalIndex = (value, name) => {
  if (value === '') return null
  if (!/^\d+$/.test(value)) reject('resume_state_invalid', `${name} must be empty or a non-negative integer`)
  return Number(value)
}

const validateCheckpointKind = (checkpoint) => {
  const { kind, phase, fields } = checkpoint
  if (kind === 'AUTHORIZATION') {
    requireFields(fields, ['decision', 'scope', 'exclusions', '診斷'])
    validateAuthorization(fields)
  }
  if (kind === 'HELD') {
    requireFields(fields, ['reason'])
    if (!ALLOWED_HELD_REASONS.has(fields.reason)) {
      reject('resume_state_invalid', `held reason is outside the allowlist: ${fields.reason}`)
    }
  }
  if (kind === 'RESUMED') requireFields(fields, ['decision'])
  if (kind === 'DONE' && phase === 'P7') {
    requireFields(fields, ['mergeCommit', 'prHead'])
    if (!/^[0-9a-f]{40}$/i.test(fields.mergeCommit) || fields.mergeCommit.toLowerCase() !== fields.head.toLowerCase()) {
      reject('resume_state_invalid', 'DONE@P7 mergeCommit must be the full current state HEAD')
    }
    if (!/^[0-9a-f]{40}$/i.test(fields.prHead) || !fields.evidenceHead) {
      reject('resume_state_invalid', 'DONE@P7 requires a full PR head and non-empty evidenceHead')
    }
  }
}

const validateNewRunSchema = (checkpoint) => {
  const { kind, phase, fields } = checkpoint
  if (kind !== 'NEW_RUN') return
  if (phase !== 'P0') reject('resume_state_invalid', 'NEW_RUN is valid only at P0')
  requireFields(fields, NEW_RUN_FIELDS)
  if (fields.boundarySchema !== NEW_RUN_BOUNDARY.schema_version ||
      fields.ownerProvenance !== NEW_RUN_BOUNDARY.owner_provenance) {
    reject('resume_state_invalid', 'NEW_RUN schema or owner provenance marker changed')
  }
  for (const [key, value] of Object.entries(NEW_RUN_BOUNDARY.counter_resets)) {
    if (fields[key] !== value) reject('resume_state_invalid', `NEW_RUN must reset ${key}`)
  }
  for (const [key, value] of Object.entries(NEW_RUN_BOUNDARY.field_resets)) {
    if (fields[key] !== value) reject('resume_state_invalid', `NEW_RUN must reset ${key}`)
  }
  for (const key of [
    'previousStateSha256', 'previousTerminalSha256',
    'ownerMessageSha256', 'ownerTupleSha256',
  ]) {
    if (!/^[0-9a-f]{64}$/.test(fields[key] || '')) {
      reject('resume_state_invalid', `${key} must be lowercase SHA-256`)
    }
  }
  if (!/^[0-9a-f]{40}$/.test(fields.previousHead || '') ||
      !/^[0-9a-f]{40}$/.test(fields.head || '')) {
    reject('resume_state_invalid', 'NEW_RUN old and new HEADs must be full lowercase SHAs')
  }
  if (parseExactInteger(fields.runSequence, 'runSequence') < 2 ||
      parseExactInteger(fields.previousCheckpointCount, 'previousCheckpointCount') < 1 ||
      parseExactInteger(fields.ownerMessageBytes, 'ownerMessageBytes') < 1) {
    reject('resume_state_invalid', 'NEW_RUN sequence, checkpoint count, and owner bytes must be positive')
  }
  if (fields.newRunId !== expectedNewRunId(fields) ||
      fields.ownerTupleSha256 !== expectedOwnerTupleSha256(fields)) {
    reject('resume_state_invalid', 'NEW_RUN identity or owner tuple binding is invalid')
  }
  if (fields['診斷'] !== 'owner-authorized-new-run-boundary' ||
      fields['需要使用者決定'] !== 'none') {
    reject('resume_state_invalid', 'NEW_RUN diagnostic fields are noncanonical')
  }
}

const validateCheckpointSchema = (checkpoint, limits, platform = null) => {
  const { phase, fields } = checkpoint
  requireFields(fields, COMMON_FIELDS)
  validateCheckpointKind(checkpoint)
  validateNewRunSchema(checkpoint)
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/.test(fields.slug) || !fields.spec || !fields.branch || !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateStamp)) {
    reject('resume_state_invalid', 'bounded lowercase slug, spec, branch, and ISO dateStamp are required')
  }
  if (!['true', 'false'].includes(fields.userFacing)) {
    reject('resume_state_invalid', 'userFacing must be true or false')
  }
  if (!/^[0-9a-f]{7,40}$/i.test(fields.head)) reject('resume_state_invalid', 'head must be a 7-40 character git SHA')
  if (!['full', 'evidence-closeout'].includes(fields.executionMode)) {
    reject('resume_state_invalid', `invalid executionMode: ${fields.executionMode}`)
  }
  if (fields.executionMode === 'evidence-closeout') {
    const change = relativeToWorktree(fields.spec, fields.worktree)
    if (!change || !/^openspec\/changes\/[^/]+$/.test(change.toLowerCase())) {
      reject('resume_state_invalid', 'evidence-closeout spec must be the named OpenSpec change inside the expected worktree')
    }
  }
  const closeoutTaskIds = fields.closeoutTaskIds.split(',').map((id) => id.trim()).filter(Boolean)
  if (closeoutTaskIds.length > 16 || new Set(closeoutTaskIds).size !== closeoutTaskIds.length ||
      closeoutTaskIds.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))) {
    reject('resume_state_invalid', 'closeoutTaskIds must be unique explicit IDs (maximum 16)')
  }
  if (fields.executionMode === 'evidence-closeout' && closeoutTaskIds.length === 0) {
    reject('resume_state_invalid', 'evidence-closeout requires explicit closeoutTaskIds')
  }
  if (fields.executionMode === 'full' && closeoutTaskIds.length > 0) {
    reject('resume_state_invalid', 'full execution mode must not carry closeoutTaskIds')
  }
  parseOptionalIndex(fields.taskIndex, 'taskIndex')
  if (fields.prNumber && !/^\d+$/.test(fields.prNumber)) reject('resume_state_invalid', 'prNumber must be empty or numeric')
  checkpoint.counters = {
    agentCalls: parseCounter(fields.agentCalls, 'agentCalls', limits.agentCalls),
    p5Rounds: parseCounter(fields.p5Rounds, 'p5Rounds', limits.p5Rounds),
    evidenceAttempts: parseCounter(fields.evidenceAttempts, 'evidenceAttempts', limits.evidenceAttempts),
  }
  if (fields.evidenceHead && !/^[0-9a-f]{7,40}$/i.test(fields.evidenceHead)) {
    reject('resume_state_invalid', 'evidenceHead must be empty or a 7-40 character git SHA')
  }
  validateRunIds(fields.runIds, platform, phase, fields.executionMode)
  checkpoint.closeoutTaskIds = closeoutTaskIds
  return checkpoint
}

const parseHistoricalCheckpoint = (line, limits) => {
  return validateCheckpointSchema(parseStateLine(line), limits)
}

const validateNewRunRawBinding = (checkpoint, record, recordIndex, buffer) => {
  if (checkpoint.kind !== 'NEW_RUN') return
  const { fields } = checkpoint
  const previousBytes = parseExactInteger(fields.previousStateBytes, 'previousStateBytes')
  if (previousBytes !== record.start || recordIndex < 1) {
    reject('resume_state_invalid', 'NEW_RUN does not begin at the bound previous-state byte offset')
  }
  const previous = buffer.subarray(0, record.start)
  if (sha256(previous) !== fields.previousStateSha256 ||
      recordIndex !== parseExactInteger(fields.previousCheckpointCount, 'previousCheckpointCount')) {
    reject('resume_state_invalid', 'NEW_RUN previous-state hash, size, or checkpoint count changed')
  }
  if (sha256(stateRecords(previous).at(-1).rawLine) !== fields.previousTerminalSha256) {
    reject('resume_state_invalid', 'NEW_RUN previous terminal checkpoint hash changed')
  }
  const expectedSequence = stateRecords(previous)
    .filter(({ line }) => line.startsWith('NEW_RUN@P0 |')).length + 2
  if (parseExactInteger(fields.runSequence, 'runSequence') !== expectedSequence) {
    reject('resume_state_invalid', 'NEW_RUN runSequence does not increment the audit chain')
  }
  if (record.line !== canonicalNewRunLine(fields)) {
    reject('resume_state_invalid', 'NEW_RUN line is not in exact canonical field order')
  }
}

const isMaxBudgetInvalidRecovery = (checkpoint) =>
  checkpoint.kind === 'HELD' &&
  checkpoint.fields.reason === 'resume_state_invalid' &&
  Object.values(checkpoint.counters).every((counter) => counter.used === counter.limit)

const validateNewRunTransition = (previous, current) => {
  if (previous.kind !== 'HELD' ||
      previous.fields.reason !== NEW_RUN_BOUNDARY.required_previous_reason) {
    reject('resume_state_invalid', 'NEW_RUN requires terminal HELD reason=run_budget_exhausted')
  }
  if (!Object.values(previous.counters).some(({ used, limit }) => used === limit)) {
    reject('resume_state_invalid', 'NEW_RUN requires at least one exactly exhausted fixed counter')
  }
  const bindings = {
    previousSpec: 'spec', previousSlug: 'slug', previousBranch: 'branch',
    previousWorktree: 'worktree', previousHead: 'head',
  }
  for (const [currentKey, previousKey] of Object.entries(bindings)) {
    if (current.fields[currentKey] !== previous.fields[previousKey]) {
      reject('resume_state_invalid', `NEW_RUN changed bound ${currentKey}`)
    }
  }
  for (const key of ['userFacing', 'executionMode', 'closeoutTaskIds']) {
    if (current.fields[key] !== previous.fields[key]) {
      reject('resume_state_invalid', `NEW_RUN changed inherited ${key}`)
    }
  }
  const oldSpec = relativeToWorktree(previous.fields.spec, previous.fields.worktree)
  const newSpec = relativeToWorktree(current.fields.spec, current.fields.worktree)
  const canonicalSpec = `openspec/changes/${current.fields.slug}`.toLowerCase()
  if (!oldSpec || !newSpec || oldSpec.toLowerCase() !== canonicalSpec ||
      newSpec.toLowerCase() !== canonicalSpec) {
    reject('resume_state_invalid', 'NEW_RUN must migrate the same canonical OpenSpec change')
  }
  const ancestor = runGit(current.fields.worktree, [
    'merge-base', '--is-ancestor', previous.fields.head, current.fields.head,
  ])
  if (ancestor.error || ancestor.status !== 0) {
    reject('resume_state_invalid', 'NEW_RUN target HEAD is not a proven descendant of the prior run HEAD')
  }
}

const validateParsedTransition = (previous, current) => {
  if (previous.kind === 'DONE' && previous.phase === 'P7') {
    reject('resume_state_invalid', 'DONE@P7 is terminal and cannot be resumed or extended')
  }
  if (previous.kind === 'HELD' && NON_RESUMABLE_HELD_REASONS.has(previous.fields.reason)) {
    reject('resume_state_invalid', `${previous.fields.reason} is terminal in this audit chain and cannot be extended`)
  }
  if (isMaxBudgetInvalidRecovery(previous)) {
    reject('resume_state_invalid', 'max-budget resume_state_invalid recovery is terminal and cannot be extended')
  }
  if (current.kind === 'NEW_RUN') {
    validateNewRunTransition(previous, current)
    return
  }
  if (previous.kind === 'HELD' && previous.fields.reason === 'run_budget_exhausted') {
    reject('resume_state_invalid', 'run_budget_exhausted can be extended only by owner-bound NEW_RUN@P0')
  }
  if (!ALLOWED_PHASE_TRANSITIONS.has(`${previous.phase}>${current.phase}`)) {
    reject('resume_state_invalid', `illegal phase transition: ${previous.phase} -> ${current.phase}`)
  }
  if (previous.kind === 'HELD' &&
      (current.phase !== previous.phase || !['RESUMED', 'AUTHORIZATION'].includes(current.kind))) {
    reject('resume_state_invalid', 'HELD checkpoint requires same-phase RESUMED or AUTHORIZATION before progress')
  }

  const terminal = current.kind === 'DONE' && current.phase === 'P7'
  for (const key of ['slug', 'userFacing', 'dateStamp', 'executionMode', 'closeoutTaskIds']) {
    if (current.fields[key] !== previous.fields[key]) reject('resume_state_invalid', `${key} changed across checkpoints`)
  }
  if (!terminal) {
    for (const key of ['spec', 'branch', 'worktree']) {
      if (current.fields[key] !== previous.fields[key]) reject('resume_state_invalid', `${key} changed across checkpoints`)
    }
  } else if (current.fields.prHead.toLowerCase() !== previous.fields.head.toLowerCase()) {
    reject('resume_state_invalid', 'DONE@P7 prHead must equal the preceding checkpoint HEAD')
  }

  for (const key of ['agentCalls', 'p5Rounds', 'evidenceAttempts']) {
    if (current.counters[key].used < previous.counters[key].used) {
      reject('resume_state_invalid', `${key} decreased across checkpoints`)
    }
  }
  if (previous.fields.prNumber && current.fields.prNumber !== previous.fields.prNumber) {
    reject('resume_state_invalid', 'prNumber changed or was cleared across checkpoints')
  }
  const previousTaskIndex = parseOptionalIndex(previous.fields.taskIndex, 'taskIndex')
  const currentTaskIndex = parseOptionalIndex(current.fields.taskIndex, 'taskIndex')
  if (previousTaskIndex !== null && (currentTaskIndex === null || currentTaskIndex < previousTaskIndex)) {
    reject('resume_state_invalid', 'taskIndex decreased or was cleared across checkpoints')
  }
  if (current.fields.evidenceHead !== previous.fields.evidenceHead &&
      current.counters.evidenceAttempts.used <= previous.counters.evidenceAttempts.used) {
    reject('resume_state_invalid', 'evidenceHead changed without consuming a new evidence attempt')
  }

  const previousIds = extractRunIds(previous.fields.runIds)
  const currentIds = extractRunIds(current.fields.runIds)
  const runIdFamilies = ['claude', 'codex', 'grok']
  for (const family of runIdFamilies) {
    for (const id of previousIds[family]) {
      if (!currentIds[family].has(id)) reject('resume_state_invalid', `runIds dropped prior actual ID: ${id}`)
    }
  }
  const previousFamilies = runIdFamilies.filter((family) => previousIds[family].size > 0)
  const newlyAddedFamilies = runIdFamilies.filter((family) => currentIds[family].size > 0 && previousIds[family].size === 0)
  const crossedCli = previousFamilies.length > 0 && newlyAddedFamilies.length > 0
  if (crossedCli && (current.kind !== 'RESUMED' || current.fields.decision !== 'cross-cli-handoff')) {
    reject('resume_state_invalid', 'cross-CLI handoff requires RESUMED with decision=cross-cli-handoff')
  }
}

const validateAuditChain = (records, current, limits, buffer) => {
  if (records.length < 2) {
    validateNewRunRawBinding(current, records[0], 0, buffer)
    return
  }
  const historical = []
  try {
    for (let index = 0; index < records.length - 1; index += 1) {
      const parsed = parseHistoricalCheckpoint(records[index].line, limits)
      validateNewRunRawBinding(parsed, records[index], index, buffer)
      historical.push(parsed)
    }
    for (let index = 1; index < historical.length; index += 1) {
      validateParsedTransition(historical[index - 1], historical[index])
    }
  } catch {
    if (isMaxBudgetInvalidRecovery(current)) return
    reject('resume_state_invalid', 'previous checkpoint is invalid; append only a max-budget HELD@... reason=resume_state_invalid checkpoint')
  }
  validateNewRunRawBinding(current, records.at(-1), records.length - 1, buffer)
  validateParsedTransition(historical.at(-1), current)
}

const main = () => {
  loadMachineContract()
  const cli = parseCli(process.argv.slice(2))
  const statePath = cli.state
  const platform = cli.platform
  const requiredCli = ['state', 'platform', 'git-exe', 'expected-head', 'expected-worktree', 'expected-agent-limit', 'expected-p5-limit', 'expected-evidence-limit', 'trusted-main-ref']
  const missingCli = requiredCli.filter((key) => !cli[key])
  if (missingCli.length || !['claude', 'codex', 'grok'].includes(platform)) {
    reject('resume_state_invalid', `missing or invalid validator arguments: ${missingCli.join(',') || 'platform'}`)
  }
  if (cli['trusted-main-ref'] !== TERMINAL_EVIDENCE.remote_main_ref) {
    reject('resume_state_invalid', `--trusted-main-ref must be ${TERMINAL_EVIDENCE.remote_main_ref}`)
  }
  const limits = {
    agentCalls: parsePositiveInteger(cli['expected-agent-limit'], 'expected-agent-limit'),
    p5Rounds: parsePositiveInteger(cli['expected-p5-limit'], 'expected-p5-limit'),
    evidenceAttempts: parsePositiveInteger(cli['expected-evidence-limit'], 'expected-evidence-limit'),
  }
  if (limits.agentCalls !== MAX_AGENT_CALLS || limits.p5Rounds !== MAX_P5_ROUNDS || limits.evidenceAttempts !== MAX_EVIDENCE_ATTEMPTS) {
    reject('resume_state_invalid', 'validator limits must be exactly agentCalls=40, p5Rounds=2, evidenceAttempts=2')
  }
  const trusted = validateTrustedGit(cli['git-exe'], cli['expected-worktree'])
  TRUSTED_GIT_EXE = trusted.resolvedGit
  if (!fs.existsSync(statePath) || !fs.statSync(statePath).isFile()) {
    reject('resume_state_invalid', `state file not found: ${statePath}`)
  }
  if (fs.statSync(statePath).size > 1024 * 1024) reject('resume_state_invalid', 'state file exceeds the 1 MiB audit limit')
  const stateBuffer = fs.readFileSync(statePath)
  const records = stateRecords(stateBuffer)
  if (!records.length) reject('resume_state_invalid', 'state file has no non-empty lines')
  if (records.length > 500) reject('resume_state_invalid', 'state file exceeds the 500-checkpoint audit limit')
  const current = validateCheckpointSchema(parseStateLine(records.at(-1).line), limits, platform)
  const { kind, phase, fields, counters, closeoutTaskIds } = current
  if (!fields.worktree || !fs.existsSync(fields.worktree) || !fs.statSync(fields.worktree).isDirectory() ||
      normalizedPath(fs.realpathSync(fields.worktree)) !== normalizedPath(trusted.resolvedWorktree)) {
    reject('resume_state_invalid', `state worktree ${fields.worktree} does not match expected worktree ${cli['expected-worktree']}`)
  }
  if (kind === 'NEW_RUN') {
    const canonicalState = path.join(fields.worktree, 'artifacts', 'spec-to-done', `${fields.slug}-state.md`)
    if (normalizedPath(fs.realpathSync(statePath)) !== normalizedPath(canonicalState)) {
      reject('resume_state_invalid', 'NEW_RUN must be stored at the canonical durable-state path')
    }
    validateActualBranch(fields)
  }
  if (!/^[0-9a-f]{7,40}$/i.test(cli['expected-head']) || fields.head.toLowerCase() !== cli['expected-head'].toLowerCase()) {
    reject('evidence_stale', `state HEAD ${fields.head} does not match current HEAD ${cli['expected-head']}`)
  }
  validateActualHead(fields, cli['expected-head'])
  validateWorkingTree(fields)
  if (kind === 'DONE' && phase === 'P7') {
    validateTerminalP7(fields)
  } else {
    if (fields.evidenceHead) validateEvidenceAncestry(fields)
  }
  validateAuditChain(records, current, limits, stateBuffer)
  process.stdout.write(JSON.stringify({
    ok: true,
    kind,
    phase,
    executionMode: fields.executionMode,
    closeoutTaskIds,
    head: fields.head,
    counters,
    fields,
  }))
}

try {
  main()
} catch (error) {
  const held = error instanceof ContractError ? error.held : 'resume_state_invalid'
  const detail = error instanceof Error ? error.message : String(error)
  const extra = error instanceof ContractError ? error.extra : {}
  process.stdout.write(JSON.stringify({ ok: false, held, detail, ...extra }))
  process.exitCode = 2
}
