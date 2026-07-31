#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ALLOWED_PHASES = new Set(['P0', 'P1', 'P3', 'P4', 'P5', 'P6', 'P7'])
const STATE_PREFIX = /^(HELD|DONE|RESUMED|AUTHORIZATION)@(P0|P1|P3|P4|P5|P6|P7)$/
const MAX_AGENT_CALLS = 40
const MAX_P5_ROUNDS = 2
const MAX_EVIDENCE_ATTEMPTS = 2
const COMMON_FIELDS = [
  'spec', 'slug', 'userFacing', 'dateStamp', 'branch', 'worktree', 'head', 'executionMode',
  'closeoutTaskIds', 'planPath', 'taskIndex', 'prNumber', 'runIds', 'agentCalls', 'p5Rounds',
  'evidenceAttempts', 'evidenceHead', '診斷', '需要使用者決定',
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
const ALLOWED_HELD_REASONS = new Set([
  'bad_args',
  'bad_findings',
  'plan_author_failed',
  'plan_parse_failed',
  'reviewer_agent_failed',
  'plan_not_aligned',
  'critical_impact',
  'impact_unavailable',
  'plan_error_at_task',
  'spec_review_not_closing',
  'quality_review_not_closing',
  'detect_changes_repeatedly_failing',
  'no_browser_engine',
  'no_browser_evidence',
  'test_deploy_process_unproven',
  'host_env_blocked',
  'ledger_mismatch',
  'review_required',
  'human_approval_required',
  'reviewer_permission_not_strict',
  'reviewer_permission_changed_after_verdict',
  'trusted_elevated_authorization_unavailable',
  'unexpected_elevated_authorization',
  'branch_protection_single_owner_gate_not_strict',
  'cyber_safeguard_payload',
  'ship_blocked',
  'run_budget_exhausted',
  'resume_state_invalid',
  'scope_drift',
  'evidence_stale',
  'evidence_not_closing',
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

const requireFields = (fields, required) => {
  const missing = required.filter((key) => !Object.hasOwn(fields, key))
  if (missing.length) reject('resume_state_invalid', `missing state fields: ${missing.join(',')}`, { missing })
}

const extractRunIds = (runIds) => ({
  claude: new Set(String(runIds || '').match(/\bwf_[A-Za-z0-9_-]+\b/g) || []),
  codex: new Set(String(runIds || '').match(/codex:[A-Za-z0-9][A-Za-z0-9._:-]{7,}/g) || []),
})

const validateRunIds = (runIds, platform, phase, executionMode) => {
  if (/native[-_:]/i.test(runIds)) {
    reject('resume_state_invalid', 'descriptive native-* labels are not resumable run IDs')
  }
  const canBeNone = phase === 'P0' || (phase === 'P1' && executionMode === 'evidence-closeout')
  if (runIds === 'none' && canBeNone) return
  const ids = extractRunIds(runIds)
  if (platform === 'claude' && ids.claude.size === 0) {
    reject('resume_state_invalid', 'Claude state must contain an actual wf_* run ID')
  }
  if (platform === 'codex' && ids.codex.size === 0) {
    reject('resume_state_invalid', 'Codex state must contain codex:<actual-session-or-agent-id>')
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
  if (fields.executionMode !== 'evidence-closeout') return true
  const change = relativeToWorktree(fields.spec, fields.worktree)
  return Boolean(change && file === `${change.toLowerCase()}/tasks.md`)
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
    if (!/^[0-9a-f]{7,40}$/i.test(fields.mergeCommit) || fields.mergeCommit.toLowerCase() !== fields.head.toLowerCase()) {
      reject('resume_state_invalid', 'DONE@P7 mergeCommit must be the current state HEAD')
    }
    if (!/^[0-9a-f]{7,40}$/i.test(fields.prHead) || !fields.evidenceHead) {
      reject('resume_state_invalid', 'DONE@P7 requires a PR head and non-empty evidenceHead')
    }
  }
}

const parseHistoricalCheckpoint = (line, limits) => {
  const checkpoint = parseStateLine(line)
  requireFields(checkpoint.fields, COMMON_FIELDS)
  validateCheckpointKind(checkpoint)
  checkpoint.counters = {
    agentCalls: parseCounter(checkpoint.fields.agentCalls, 'agentCalls', limits.agentCalls),
    p5Rounds: parseCounter(checkpoint.fields.p5Rounds, 'p5Rounds', limits.p5Rounds),
    evidenceAttempts: parseCounter(checkpoint.fields.evidenceAttempts, 'evidenceAttempts', limits.evidenceAttempts),
  }
  if (!['full', 'evidence-closeout'].includes(checkpoint.fields.executionMode)) {
    reject('resume_state_invalid', 'previous checkpoint has an invalid executionMode')
  }
  return checkpoint
}

const validateParsedTransition = (previous, current) => {
  if (previous.kind === 'DONE' && previous.phase === 'P7') {
    reject('resume_state_invalid', 'DONE@P7 is terminal and cannot be resumed or extended')
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
  for (const family of ['claude', 'codex']) {
    for (const id of previousIds[family]) {
      if (!currentIds[family].has(id)) reject('resume_state_invalid', `runIds dropped prior actual ID: ${id}`)
    }
  }
  const crossedCli =
    (previousIds.claude.size > 0 && previousIds.codex.size === 0 && currentIds.codex.size > 0) ||
    (previousIds.codex.size > 0 && previousIds.claude.size === 0 && currentIds.claude.size > 0)
  if (crossedCli && (current.kind !== 'RESUMED' || current.fields.decision !== 'cross-cli-handoff')) {
    reject('resume_state_invalid', 'cross-CLI handoff requires RESUMED with decision=cross-cli-handoff')
  }
}

const isMaxBudgetInvalidRecovery = (checkpoint) =>
  checkpoint.kind === 'HELD' &&
  checkpoint.fields.reason === 'resume_state_invalid' &&
  Object.values(checkpoint.counters).every((counter) => counter.used === counter.limit)

const validateAuditChain = (lines, current, limits) => {
  if (lines.length < 2) return
  const historical = []
  try {
    for (const line of lines.slice(0, -1)) {
      historical.push(parseHistoricalCheckpoint(line, limits))
    }
  } catch {
    if (isMaxBudgetInvalidRecovery(current)) return
    reject('resume_state_invalid', 'previous checkpoint is invalid; append only a max-budget HELD@... reason=resume_state_invalid checkpoint')
  }
  for (let index = 1; index < historical.length; index += 1) {
    validateParsedTransition(historical[index - 1], historical[index])
  }
  validateParsedTransition(historical.at(-1), current)
}

const main = () => {
  const cli = parseCli(process.argv.slice(2))
  const statePath = cli.state
  const platform = cli.platform
  const requiredCli = ['state', 'platform', 'git-exe', 'expected-head', 'expected-worktree', 'expected-agent-limit', 'expected-p5-limit', 'expected-evidence-limit']
  const missingCli = requiredCli.filter((key) => !cli[key])
  if (missingCli.length || !['claude', 'codex'].includes(platform)) {
    reject('resume_state_invalid', `missing or invalid validator arguments: ${missingCli.join(',') || 'platform'}`)
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
  const lines = fs.readFileSync(statePath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) reject('resume_state_invalid', 'state file has no non-empty lines')
  if (lines.length > 500) reject('resume_state_invalid', 'state file exceeds the 500-checkpoint audit limit')
  const current = parseStateLine(lines.at(-1))
  const { kind, phase, fields } = current
  requireFields(fields, COMMON_FIELDS)
  validateCheckpointKind(current)
  if (!fields.worktree || !fs.existsSync(fields.worktree) || !fs.statSync(fields.worktree).isDirectory() ||
      normalizedPath(fs.realpathSync(fields.worktree)) !== normalizedPath(trusted.resolvedWorktree)) {
    reject('resume_state_invalid', `state worktree ${fields.worktree} does not match expected worktree ${cli['expected-worktree']}`)
  }
  if (!fields.slug || !fields.spec || !fields.branch || !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateStamp)) {
    reject('resume_state_invalid', 'slug, spec, branch, and ISO dateStamp are required')
  }
  if (!['true', 'false'].includes(fields.userFacing)) {
    reject('resume_state_invalid', 'userFacing must be true or false')
  }
  if (!/^[0-9a-f]{7,40}$/i.test(fields.head)) reject('resume_state_invalid', 'head must be a 7-40 character git SHA')
  if (!/^[0-9a-f]{7,40}$/i.test(cli['expected-head']) || fields.head.toLowerCase() !== cli['expected-head'].toLowerCase()) {
    reject('evidence_stale', `state HEAD ${fields.head} does not match current HEAD ${cli['expected-head']}`)
  }

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
  const counters = {
    agentCalls: parseCounter(fields.agentCalls, 'agentCalls', limits.agentCalls),
    p5Rounds: parseCounter(fields.p5Rounds, 'p5Rounds', limits.p5Rounds),
    evidenceAttempts: parseCounter(fields.evidenceAttempts, 'evidenceAttempts', limits.evidenceAttempts),
  }
  current.counters = counters
  if (fields.evidenceHead) {
    if (!/^[0-9a-f]{7,40}$/i.test(fields.evidenceHead)) {
      reject('resume_state_invalid', 'evidenceHead must be empty or a 7-40 character git SHA')
    }
  }
  validateRunIds(fields.runIds, platform, phase, fields.executionMode)
  validateActualHead(fields, cli['expected-head'])
  validateWorkingTree(fields)
  if (kind === 'DONE' && phase === 'P7') {
    validateTerminalP7(fields)
  } else {
    if (fields.evidenceHead) validateEvidenceAncestry(fields)
  }
  validateAuditChain(lines, current, limits)
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
