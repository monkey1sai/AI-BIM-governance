import { createHash } from 'node:crypto'


export class AutonomousDeliveryFinalizationError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'AutonomousDeliveryFinalizationError'
    this.code = code
    this.detail = detail
  }
}

const fail = (code, detail) => {
  throw new AutonomousDeliveryFinalizationError(code, detail)
}

const SHA1 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const SECRET_VALUES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{8,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/iu,
  /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|DATABASE_URL|API_KEY)[A-Z0-9_]*\s*=\s*[^\s\r\n]{4,}/u,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^/\s:@]+:[^@\s/]+@/iu,
]
const SECRET_BEARING_ENV_PATH = /(?:^|\/)\.env(?:$|\.)/u
const SAFE_ENV_TEMPLATE_PATH = /\.env(?:\.[A-Za-z0-9_-]+)*\.(?:example|sample|template)$/u
const MECHANISM_PATH = /^(?:\.github\/|agent-contracts\/|scripts\/|docs\/agents\/|\.claude\/skills\/|\.codex\/skills\/|agent-skills-manifest\.json$|AGENTS\.md$|CLAUDE\.md$|openspec\/)/u
const REVIEW_MODES = Object.freeze([
  'mechanical_only', 'focused_semantic', 'risk_scoped_specialists',
  'critical_machine_adjudication',
])

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
const clone = (value) => structuredClone(value)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}
export const canonicalSha256 = (value) => sha256(Buffer.from(JSON.stringify(canonicalize(value)), 'utf8'))

const exactKeys = (value, expected, code, detail) => {
  if (!isPlainObject(value)) fail(code, detail)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, detail)
  }
}

const assertSha1 = (value, code, detail) => {
  if (typeof value !== 'string' || !SHA1.test(value)) fail(code, detail)
}

const assertSha256 = (value, code, detail) => {
  if (typeof value !== 'string' || !SHA256.test(value)) fail(code, detail)
}

const assertIdentifier = (value, code, detail) => {
  if (typeof value !== 'string' || value.length < 3 || value.length > 160 || !IDENTIFIER.test(value)) {
    fail(code, detail)
  }
}

const assertNoSecretShape = (value, context = '$') => {
  if (typeof value === 'string') {
    if (SECRET_VALUES.some((pattern) => pattern.test(value))) {
      fail('secret_material_detected', `${context}_contains_secret_material`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretShape(item, `${context}[${index}]`))
    return
  }
  if (!isPlainObject(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (/(?:token|password|secret|private.?key|credential(?:value|material|secret)|ssh.?key)/iu.test(key)) {
      fail('secret_material_detected', `${context}_${key}_secret_field_forbidden`)
    }
    assertNoSecretShape(item, `${context}.${key}`)
  }
}

export function normalizeReviewMode(mode) {
  if (mode === 'human_critical') {
    fail('legacy_review_mode_rejected', 'human_critical_has_no_machine_authority_migration')
  }
  if (!REVIEW_MODES.includes(mode)) fail('review_mode_unknown', 'review_mode_not_closed')
  return mode
}

export async function collectPaginatedConnection(fetchPage, {
  connection,
  maxPages = 20,
  maxNodes = 3000,
} = {}) {
  if (typeof fetchPage !== 'function') fail('pagination_incomplete', 'page_fetcher_required')
  assertIdentifier(connection, 'pagination_incomplete', 'connection_name_invalid')
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(maxNodes) || maxNodes < 1) {
    fail('pagination_budget_exceeded', 'pagination_budget_invalid')
  }
  const nodes = []
  const seenCursors = new Set()
  let cursor = null
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await fetchPage(cursor, { connection, pageNumber })
    if (!isPlainObject(page) || !Array.isArray(page.nodes) || !isPlainObject(page.pageInfo)) {
      fail('pagination_incomplete', `${connection}_page_shape_invalid`)
    }
    nodes.push(...page.nodes)
    if (nodes.length > maxNodes) fail('pagination_budget_exceeded', `${connection}_node_budget_exceeded`)
    if (page.pageInfo.hasNextPage === false) return deepFreeze(nodes)
    if (page.pageInfo.hasNextPage !== true) fail('pagination_incomplete', `${connection}_has_next_page_unknown`)
    const nextCursor = page.pageInfo.endCursor
    if (typeof nextCursor !== 'string' || nextCursor.length === 0) {
      fail('pagination_incomplete', `${connection}_next_cursor_missing`)
    }
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      fail('pagination_cursor_loop', `${connection}_cursor_repeated`)
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }
  fail('pagination_budget_exceeded', `${connection}_page_budget_exceeded`)
}

const assertRepoPath = (value) => {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
    value !== value.normalize('NFC') || value.includes('\\') || value.startsWith('/') ||
    value.split('/').some((part) => ['', '.', '..'].includes(part))
  ) fail('unsupported_review_surface', 'changed_path_not_canonical')
}

const DIFF_GIT_HEADER = /^diff --git (.+)$/u
const DIFF_RENAME_OR_COPY_HEADER = /^(?:rename|copy) (?:from|to) (.+)$/u
const diffSurfaceUnparseable = () => fail('unsupported_review_surface', 'diff_header_path_unparseable')

// Git quotes a header path (core.quotePath) when it contains quotes, backslashes,
// control bytes or non-ASCII bytes; escapes are C-style with octal UTF-8 bytes.
const unquoteDiffPath = (raw) => {
  if (!raw.startsWith('"')) return raw
  if (raw.length < 2 || !raw.endsWith('"')) diffSurfaceUnparseable()
  const bytes = []
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index]
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      continue
    }
    const next = raw[index + 1]
    if (next === '\\' || next === '"') {
      bytes.push(next.charCodeAt(0))
      index += 1
    } else if (next === 'n' || next === 't' || next === 'r') {
      bytes.push({ n: 10, t: 9, r: 13 }[next])
      index += 1
    } else if (/^[0-7]{3}$/u.test(raw.slice(index + 1, index + 4))) {
      bytes.push(parseInt(raw.slice(index + 1, index + 4), 8))
      index += 3
    } else {
      diffSurfaceUnparseable()
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

const stripDiffPrefix = (value, prefix) => {
  if (!value.startsWith(prefix)) diffSurfaceUnparseable()
  return value.slice(prefix.length)
}

const closingQuoteIndex = (value, start) => {
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1
      continue
    }
    if (value[index] === '"') return index
  }
  return -1
}

const splitDiffGitHeader = (rest) => {
  if (rest.startsWith('"')) {
    const closing = closingQuoteIndex(rest, 0)
    if (closing < 0 || rest[closing + 1] !== ' ') diffSurfaceUnparseable()
    return [
      stripDiffPrefix(unquoteDiffPath(rest.slice(0, closing + 1)), 'a/'),
      stripDiffPrefix(unquoteDiffPath(rest.slice(closing + 2)), 'b/'),
    ]
  }
  const quotedRight = rest.lastIndexOf(' "b/')
  if (quotedRight >= 0) {
    return [
      stripDiffPrefix(rest.slice(0, quotedRight), 'a/'),
      stripDiffPrefix(unquoteDiffPath(rest.slice(quotedRight + 1)), 'b/'),
    ]
  }
  const candidates = []
  let search = rest.indexOf(' b/')
  while (search >= 0) {
    candidates.push(search)
    search = rest.indexOf(' b/', search + 1)
  }
  if (candidates.length === 0) diffSurfaceUnparseable()
  const identical = candidates.find((index) => rest.slice(2, index) === rest.slice(index + 3))
  const split = identical ?? (candidates.length === 1 ? candidates[0] : null)
  if (split === null) diffSurfaceUnparseable()
  return [stripDiffPrefix(rest.slice(0, split), 'a/'), stripDiffPrefix(rest.slice(split + 1), 'b/')]
}

const assertDiffSurfacePath = (value) => {
  try {
    assertRepoPath(value)
  } catch {
    fail('unsupported_review_surface', 'diff_surface_path_not_canonical')
  }
  return value
}

// Every source/destination path named by the diff headers themselves. Review mode is
// derived from changedFiles, so the two surfaces must agree exactly or the packet
// could route a mechanism change through the lowest lane while claiming lossless.
// Producer contract: plain `git diff` output with the default `a/`/`b/` prefixes;
// combined (`--cc`) and `--no-prefix` diffs are unparseable and fail closed.
export function extractDiffSurfacePaths(diffText) {
  const paths = new Set()
  for (const rawLine of String(diffText ?? '').split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const header = DIFF_GIT_HEADER.exec(line)
    if (header) {
      for (const path of splitDiffGitHeader(header[1])) paths.add(assertDiffSurfacePath(path))
      continue
    }
    const renamed = DIFF_RENAME_OR_COPY_HEADER.exec(line)
    if (renamed) paths.add(assertDiffSurfacePath(unquoteDiffPath(renamed[1])))
  }
  return paths
}

export function classifyReviewSurface({ changedFiles, diff, limits } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    fail('unsupported_review_surface', 'changed_files_required')
  }
  const maxFiles = limits?.maxFiles
  const maxDiffBytes = limits?.maxDiffBytes
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || changedFiles.length > maxFiles) {
    fail('evidence_budget_exceeded', 'changed_file_budget_exceeded')
  }
  const bytes = Buffer.isBuffer(diff) ? diff : Buffer.from(String(diff ?? ''), 'utf8')
  if (!Number.isSafeInteger(maxDiffBytes) || maxDiffBytes < 1 || bytes.length === 0 || bytes.length > maxDiffBytes) {
    fail('evidence_budget_exceeded', 'diff_byte_budget_exceeded')
  }
  const normalized = changedFiles.map((file, index) => {
    if (!isPlainObject(file)) {
      fail('unsupported_review_surface', `changed_file_${index}_shape_invalid`)
    }
    // Renames and copies both name a source path in the diff headers.
    const carriesPreviousPath = file.status === 'renamed' || file.status === 'copied'
    exactKeys(
      file,
      carriesPreviousPath
        ? ['path', 'previousPath', 'status', 'binary', 'submodule']
        : ['path', 'status', 'binary', 'submodule'],
      'unsupported_review_surface',
      `changed_file_${index}_shape_invalid`,
    )
    assertRepoPath(file.path)
    if (carriesPreviousPath) assertRepoPath(file.previousPath)
    if (!['added', 'modified', 'deleted', 'renamed', 'copied', 'type_changed'].includes(file.status)) {
      fail('unsupported_review_surface', `changed_file_${index}_status_unknown`)
    }
    if (file.binary === true || file.submodule === true) {
      fail('unsupported_review_surface', `changed_file_${index}_binary_or_submodule`)
    }
    if (file.binary !== false || file.submodule !== false) {
      fail('unsupported_review_surface', `changed_file_${index}_surface_flags_unknown`)
    }
    return clone(file)
  })
  const surfacePaths = normalized.flatMap((file) => (
    file.status === 'renamed' || file.status === 'copied' ? [file.path, file.previousPath] : [file.path]
  ))
  if (surfacePaths.some((path) => SECRET_BEARING_ENV_PATH.test(path) && !SAFE_ENV_TEMPLATE_PATH.test(path))) {
    fail('secret_review_surface_blocked', 'secret_bearing_environment_file_not_reviewable')
  }
  if (SECRET_VALUES.some((pattern) => pattern.test(bytes.toString('utf8')))) {
    fail('secret_review_surface_blocked', 'semantic_redaction_would_change_review_bytes')
  }
  const sorted = [...normalized].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  if (sorted.some((file, index) => index > 0 && file.path.toLowerCase() === sorted[index - 1].path.toLowerCase())) {
    fail('unsupported_review_surface', 'changed_path_case_collision')
  }
  const diffPaths = extractDiffSurfacePaths(bytes.toString('utf8'))
  const declaredPaths = new Set(surfacePaths)
  if (diffPaths.size === 0) fail('unsupported_review_surface', 'diff_surface_paths_missing')
  for (const path of diffPaths) {
    if (!declaredPaths.has(path)) fail('unsupported_review_surface', 'diff_path_not_declared_in_changed_files')
  }
  for (const path of declaredPaths) {
    if (!diffPaths.has(path)) fail('unsupported_review_surface', 'changed_file_missing_from_diff_bytes')
  }
  const reviewMode = surfacePaths.some((path) => MECHANISM_PATH.test(path))
    ? 'critical_machine_adjudication'
    : surfacePaths.every((path) => path.startsWith('docs/'))
      ? 'mechanical_only'
      : 'focused_semantic'
  return deepFreeze({
    reviewMode,
    lossless: true,
    changedFiles: sorted,
    diffSha256: sha256(bytes),
    diffBytes: bytes.length,
  })
}

const FINALIZATION_PHASES = Object.freeze([
  'DRAFT', 'ROUND_1', 'BATCH_REPAIR_PENDING', 'ROUND_2', 'READY_TO_MERGE', 'CLOSED',
])
const FINALIZATION_STATE_KEYS = Object.freeze([
  'schemaVersion', 'repository', 'prNumber', 'baseOid', 'phase', 'frozenHeadOid', 'batchRepairUsed',
  'rounds', 'terminalClass', 'reasonCode', 'failureDetail',
])

const finalizationStateInvalid = (detail) => fail('finalization_state_invalid', detail)

const validateFinalizationBlockers = (blockers, { allowEmpty, detail }) => {
  if (
    !Array.isArray(blockers) || blockers.length > 128 || (!allowEmpty && blockers.length === 0) ||
    new Set(blockers).size !== blockers.length || blockers.some((blocker) => {
      try {
        assertIdentifier(blocker, 'finalization_state_invalid', detail)
        return false
      } catch {
        return true
      }
    })
  ) finalizationStateInvalid(detail)
}

const validateFinalizationState = (stateRaw) => {
  exactKeys(stateRaw, FINALIZATION_STATE_KEYS, 'finalization_state_invalid', 'state_shape_invalid')
  const state = clone(stateRaw)
  if (
    state.schemaVersion !== 'autonomous-delivery-finalization/v1' ||
    !SAFE_REPOSITORY.test(state.repository) ||
    !Number.isSafeInteger(state.prNumber) || state.prNumber < 1 ||
    !FINALIZATION_PHASES.includes(state.phase) || typeof state.batchRepairUsed !== 'boolean' ||
    !Array.isArray(state.rounds) || state.rounds.length > 2
  ) finalizationStateInvalid('state_identity_or_phase_invalid')
  assertSha1(state.baseOid, 'finalization_state_invalid', 'base_oid_invalid')
  if (state.phase === 'DRAFT') {
    if (state.frozenHeadOid !== null) finalizationStateInvalid('draft_head_must_be_unfrozen')
  } else {
    assertSha1(state.frozenHeadOid, 'finalization_state_invalid', 'frozen_head_invalid')
  }
  const rounds = state.rounds.map((round, index) => {
    exactKeys(round, ['number', 'headOid', 'status', 'blockers'], 'finalization_state_invalid', `round_${index}_shape_invalid`)
    if (round.number !== index + 1 || !['in_progress', 'completed'].includes(round.status)) {
      finalizationStateInvalid(`round_${index}_lineage_invalid`)
    }
    assertSha1(round.headOid, 'finalization_state_invalid', `round_${index}_head_invalid`)
    validateFinalizationBlockers(round.blockers, { allowEmpty: true, detail: `round_${index}_blockers_invalid` })
    if (round.status === 'in_progress' && round.blockers.length !== 0) {
      finalizationStateInvalid(`round_${index}_in_progress_has_blockers`)
    }
    return clone(round)
  })
  if (rounds.length === 2 && rounds[0].headOid === rounds[1].headOid) {
    finalizationStateInvalid('round_two_requires_new_head')
  }
  if (state.phase !== 'CLOSED' && (
    state.terminalClass !== null || state.reasonCode !== null || state.failureDetail !== null
  )) finalizationStateInvalid('nonterminal_state_has_terminal_fields')
  if (state.phase === 'DRAFT' && (rounds.length !== 0 || state.batchRepairUsed)) {
    finalizationStateInvalid('draft_lineage_invalid')
  }
  if (state.phase === 'ROUND_1' && (
    rounds.length !== 1 || rounds[0].status !== 'in_progress' || rounds[0].headOid !== state.frozenHeadOid || state.batchRepairUsed
  )) finalizationStateInvalid('round_one_lineage_invalid')
  if (state.phase === 'BATCH_REPAIR_PENDING' && (
    rounds.length !== 1 || rounds[0].status !== 'completed' || rounds[0].blockers.length === 0 ||
    rounds[0].headOid !== state.frozenHeadOid || state.batchRepairUsed
  )) finalizationStateInvalid('batch_repair_lineage_invalid')
  if (state.phase === 'ROUND_2' && (
    rounds.length !== 2 || rounds[0].status !== 'completed' || rounds[0].blockers.length === 0 ||
    rounds[1].status !== 'in_progress' || rounds[1].headOid !== state.frozenHeadOid || !state.batchRepairUsed
  )) finalizationStateInvalid('round_two_lineage_invalid')
  if (state.phase === 'READY_TO_MERGE' && (
    ![1, 2].includes(rounds.length) || rounds.at(-1).status !== 'completed' ||
    rounds.at(-1).blockers.length !== 0 || rounds.at(-1).headOid !== state.frozenHeadOid ||
    state.batchRepairUsed !== (rounds.length === 2)
  )) finalizationStateInvalid('ready_lineage_invalid')
  if (state.phase === 'CLOSED' && (
    state.terminalClass !== 'HELD' || typeof state.reasonCode !== 'string' || typeof state.failureDetail !== 'string'
  )) finalizationStateInvalid('closed_terminal_invalid')
  return { ...state, rounds }
}

export function createFinalizationState({ repository, prNumber, baseOid } = {}) {
  if (typeof repository !== 'string' || !SAFE_REPOSITORY.test(repository)) {
    fail('finalization_state_invalid', 'repository_invalid')
  }
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) fail('finalization_state_invalid', 'pr_number_invalid')
  assertSha1(baseOid, 'finalization_state_invalid', 'base_oid_invalid')
  return deepFreeze({
    schemaVersion: 'autonomous-delivery-finalization/v1',
    repository,
    prNumber,
    baseOid,
    phase: 'DRAFT',
    frozenHeadOid: null,
    batchRepairUsed: false,
    rounds: [],
    terminalClass: null,
    reasonCode: null,
    failureDetail: null,
  })
}

const closeHeld = (state, failureDetail) => deepFreeze({
  ...state,
  phase: 'CLOSED',
  terminalClass: 'HELD',
  reasonCode: 'PREMERGE_EVIDENCE_INVALID',
  failureDetail,
})

// Trusted-side inputs (collector output, never the candidate bundle) are passed
// through to the disposition validator so the gate epoch cannot be self-reported.
export function applyFinalizationEvent(stateRaw, event, {
  expectedRequiredCheckSource, collectedFindings, convergenceObservedAt, sameHeadCheckRuns,
} = {}) {
  if (!isPlainObject(stateRaw)) fail('finalization_state_invalid', 'state_shape_invalid')
  const state = validateFinalizationState(stateRaw)
  if (state.phase === 'CLOSED') fail('finalization_closed', 'closed_transaction_is_immutable')
  if (!isPlainObject(event) || typeof event.type !== 'string') fail('finalization_event_invalid', 'event_invalid')
  const eventShapes = {
    draft_observed: ['type', 'headOid'],
    ready: ['type', 'headOid'],
    batch_repair: ['type', 'headOid'],
    round_blocked: ['type', 'headOid', 'blockers', 'evidenceSha256'],
    round_converged: ['type', 'headOid', 'findingBundle'],
  }
  const eventKeys = eventShapes[event.type]
  if (!eventKeys) fail('finalization_event_invalid', 'event_type_not_closed')
  exactKeys(event, eventKeys, 'finalization_event_invalid', 'event_shape_invalid')
  if (event.type === 'draft_observed') {
    if (state.phase !== 'DRAFT') fail('finalization_event_invalid', 'draft_observation_after_ready')
    assertSha1(event.headOid, 'finalization_event_invalid', 'draft_head_invalid')
    return deepFreeze(state)
  }
  if (event.type === 'ready') {
    if (state.phase !== 'DRAFT') fail('finalization_event_invalid', 'ready_may_start_once')
    assertSha1(event.headOid, 'finalization_event_invalid', 'ready_head_invalid')
    return deepFreeze({
      ...state,
      phase: 'ROUND_1',
      frozenHeadOid: event.headOid,
      rounds: [{ number: 1, headOid: event.headOid, status: 'in_progress', blockers: [] }],
    })
  }
  if (event.type === 'batch_repair') {
    if (state.phase !== 'BATCH_REPAIR_PENDING' || state.batchRepairUsed) {
      fail('review_round_budget_exhausted', 'only_one_batch_repair_head_allowed')
    }
    assertSha1(event.headOid, 'finalization_event_invalid', 'batch_repair_head_invalid')
    if (event.headOid === state.frozenHeadOid) fail('finalization_event_invalid', 'batch_repair_requires_new_head')
    return deepFreeze({
      ...state,
      phase: 'ROUND_2',
      frozenHeadOid: event.headOid,
      batchRepairUsed: true,
      rounds: [...state.rounds, { number: 2, headOid: event.headOid, status: 'in_progress', blockers: [] }],
    })
  }
  if (!['round_blocked', 'round_converged'].includes(event.type) || !['ROUND_1', 'ROUND_2'].includes(state.phase)) {
    fail('finalization_event_invalid', 'event_not_allowed_in_phase')
  }
  assertSha1(event.headOid, 'finalization_event_invalid', 'round_head_invalid')
  if (event.headOid !== state.frozenHeadOid) return closeHeld(state, 'head_freeze_broken')
  const roundIndex = state.rounds.length - 1
  if (event.type === 'round_converged') {
    const convergence = validateFindingDispositionBundle(event.findingBundle, expectedRequiredCheckSource, {
      collectedFindings, convergenceObservedAt, sameHeadCheckRuns,
    })
    if (
      convergence.repository !== state.repository || convergence.prNumber !== state.prNumber ||
      convergence.baseOid !== state.baseOid || convergence.headOid !== state.frozenHeadOid
    ) fail('finalization_event_invalid', 'round_convergence_not_bound_to_frozen_pr')
    // An escalated finding removes the transaction from autonomous authority.
    if (convergence.status === 'escalated') return closeHeld(state, 'finding_escalated_to_external_authority')
    if (convergence.status !== 'passed' || convergence.reviewConverged !== true) {
      fail('finalization_event_invalid', 'round_convergence_not_bound_to_frozen_pr')
    }
    const rounds = state.rounds.map((round, index) => index === roundIndex
      ? { ...round, status: 'completed', blockers: [] }
      : round)
    return deepFreeze({ ...state, phase: 'READY_TO_MERGE', rounds })
  }
  if (
    !Array.isArray(event.blockers) || event.blockers.length < 1 || event.blockers.length > 128 ||
    new Set(event.blockers).size !== event.blockers.length ||
    event.blockers.some((blocker) => {
      try {
        assertIdentifier(blocker, 'finalization_event_invalid', 'blocker_invalid')
        return false
      } catch {
        return true
      }
    })
  ) fail('finalization_event_invalid', 'round_blockers_invalid')
  assertSha256(event.evidenceSha256, 'finalization_event_invalid', 'round_evidence_digest_invalid')
  const rounds = state.rounds.map((round, index) => index === roundIndex
    ? { ...round, status: 'completed', blockers: [...event.blockers] }
    : round)
  if (state.phase === 'ROUND_1') {
    return deepFreeze({ ...state, phase: 'BATCH_REPAIR_PENDING', rounds })
  }
  return closeHeld({ ...state, rounds }, 'review_round_budget_exhausted')
}

export function validateSourcePinnedRequiredCheck(check, expected) {
  exactKeys(check, ['name', 'appId', 'headOid', 'conclusion'], 'required_check_not_authoritative', 'check_shape_invalid')
  exactKeys(expected, ['name', 'appId', 'headOid'], 'required_check_not_authoritative', 'expected_source_shape_invalid')
  if (
    check.name !== expected.name || check.appId !== expected.appId ||
    check.headOid !== expected.headOid || check.conclusion !== 'success'
  ) fail('required_check_not_authoritative', 'expected_app_actual_success_required')
  assertIdentifier(check.name, 'required_check_not_authoritative', 'required_check_name_invalid')
  assertSha1(check.headOid, 'required_check_not_authoritative', 'required_check_head_invalid')
  if (!Number.isSafeInteger(check.appId) || check.appId < 1) {
    fail('required_check_not_authoritative', 'required_check_app_invalid')
  }
  return true
}

export function validateAdversarialDecision(decision) {
  if (!isPlainObject(decision) || !isPlainObject(decision.layers)) {
    fail('adversarial_output_invalid', 'decision_shape_invalid')
  }
  assertSha256(decision.packetSha256, 'adversarial_output_invalid', 'packet_digest_invalid')
  const { l1, l2, l3 } = decision.layers
  for (const [name, layer] of Object.entries({ l1, l2, l3 })) {
    if (!isPlainObject(layer) || layer.output !== 'closed') {
      fail('adversarial_output_invalid', `${name}_closed_output_required`)
    }
    assertIdentifier(layer.model, 'adversarial_output_invalid', `${name}_model_invalid`)
    // Every layer must prove it examined the same immutable packet; an L3 that
    // binds the current packet cannot launder L1/L2 output from an older head.
    if (layer.packetSha256 !== decision.packetSha256) {
      fail('adversarial_raw_binding_invalid', `${name}_did_not_reread_bound_packet`)
    }
  }
  if (l1.model === l2.model) fail('adversarial_independence_invalid', 'l2_model_must_differ_from_l1')
  const l1OutputSha256 = canonicalSha256(l1)
  if (l2.l1OutputSha256 !== l1OutputSha256) {
    fail('adversarial_raw_binding_invalid', 'l2_not_bound_to_exact_l1_output')
  }
  const l2OutputSha256 = canonicalSha256(l2)
  if (l3.l1OutputSha256 !== l1OutputSha256 || l3.l2OutputSha256 !== l2OutputSha256) {
    fail('adversarial_raw_binding_invalid', 'l3_not_bound_to_exact_layer_outputs')
  }
  if (!Array.isArray(l3.unresolvedHighCritical) || l3.unresolvedHighCritical.length > 0) {
    fail('adversarial_blocker_unresolved', 'high_or_critical_blocker_survived')
  }
  const requiredRubric = Array.from({ length: 12 }, (_, index) => `G${index + 1}`)
  if (!isPlainObject(l3.rubric) || Object.keys(l3.rubric).sort().join(',') !== [...requiredRubric].sort().join(',')) {
    fail('activation_unattested', 'g1_g12_rubric_incomplete')
  }
  for (const id of requiredRubric) {
    const item = l3.rubric[id]
    if (!isPlainObject(item) || item.status !== 'pass' || typeof item.evidence !== 'string' || !/:\d+$/u.test(item.evidence)) {
      fail('activation_unattested', `${id}_not_reproducibly_passed`)
    }
  }
  if (l3.verdict !== 'passed') fail('adversarial_blocker_unresolved', 'l3_verdict_not_passed')
  return deepFreeze({ ...clone(decision), verdict: l3.verdict })
}

export function buildExactHeadMergeRequest(snapshot, lease, { now = new Date(), method = 'squash', consumeLease } = {}) {
  if (!isPlainObject(snapshot) || !isPlainObject(lease)) fail('premerge_evidence_invalid', 'snapshot_or_lease_missing')
  // The library never authenticates or consumes a lease itself: a caller could
  // copy snapshot fields into a fabricated lease. The external merge authority
  // must verify the broker signature and atomically consume the nonce first.
  if (typeof consumeLease !== 'function') fail('merge_authority_unavailable', 'external_lease_authority_required')
  if (
    snapshot.state !== 'OPEN' || snapshot.draft !== false || snapshot.mergeable !== true ||
    snapshot.threadsComplete !== true || snapshot.unresolvedThreads !== 0
  ) fail('premerge_evidence_invalid', 'server_state_not_merge_ready')
  if (!SAFE_REPOSITORY.test(snapshot.repository) || !Number.isSafeInteger(snapshot.prNumber) || snapshot.prNumber < 1) {
    fail('premerge_evidence_invalid', 'repository_or_pr_invalid')
  }
  for (const value of [snapshot.baseOid, snapshot.headOid]) {
    assertSha1(value, 'premerge_evidence_invalid', 'snapshot_tuple_invalid')
  }
  for (const value of [snapshot.settingsEpochSha256, snapshot.evidenceSha256]) {
    assertSha256(value, 'premerge_evidence_invalid', 'snapshot_digest_invalid')
  }
  for (const key of [
    'repository', 'prNumber', 'baseOid', 'headOid', 'settingsEpochSha256', 'evidenceSha256',
  ]) {
    if (lease[key] !== snapshot[key]) fail('policy_or_settings_drift', `lease_${key}_mismatch`)
  }
  if (lease.consumed !== false || typeof lease.nonce !== 'string' || lease.nonce.length < 32) {
    fail('merge_authority_unavailable', 'lease_not_single_use')
  }
  // An invalid Date compares false against every timestamp, which would silently
  // accept an expired lease; a broken clock must fail closed before expiry math.
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    fail('merge_authority_unavailable', 'clock_invalid')
  }
  const expiresAt = Date.parse(lease.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    fail('merge_authority_unavailable', 'lease_expired')
  }
  if (!['merge', 'squash', 'rebase'].includes(method)) fail('premerge_evidence_invalid', 'merge_method_not_allowed')
  let consumed = false
  try {
    consumed = consumeLease(deepFreeze({
      repository: lease.repository,
      prNumber: lease.prNumber,
      baseOid: lease.baseOid,
      headOid: lease.headOid,
      settingsEpochSha256: lease.settingsEpochSha256,
      evidenceSha256: lease.evidenceSha256,
      nonce: lease.nonce,
      expiresAt: lease.expiresAt,
      leaseSha256: canonicalSha256(lease),
    })) === true
  } catch {
    consumed = false
  }
  if (!consumed) fail('merge_authority_unavailable', 'lease_not_authenticated_or_already_consumed')
  return deepFreeze({ method, sha: snapshot.headOid })
}

// Mergeable PR classes admitted to the delivery lock. `draft_report_only` never
// enters delivery; `release_hotfix` is mergeable and must not be locked out.
const DELIVERY_LOCK_CLASSES = Object.freeze([
  'ordinary', 'repair', 'revert', 'reconciliation', 'activation_canary', 'activation_closure', 'release_hotfix',
])
const RECOVERY_CLASSES = new Set(['repair', 'revert', 'reconciliation'])
const TERMINAL_REASONS = Object.freeze({
  DELIVERED: ['DELIVERY_VERIFIED'],
  FAILED: ['MERGED_NOT_DELIVERED'],
  HELD: [
    'PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE',
    'POLICY_OR_SETTINGS_DRIFT', 'MERGE_OUTCOME_UNVERIFIED', 'DEPLOYMENT_BLOCKED',
    'DELIVERY_PENDING_FIXPOINT', 'ACTIVATION_UNATTESTED',
  ],
})
// Closed lane mapping for a non-delivered terminal: which recovery class may bind
// to it. `null` means nothing merged, so the queue is not frozen; `[]` means the
// queue is frozen with no autonomous lane (a new user-initiated transaction is
// required); otherwise only the listed classes may acquire, bound to that ID.
const RECOVERY_LANES = Object.freeze({
  FAILED: Object.freeze({ MERGED_NOT_DELIVERED: ['repair', 'revert'] }),
  HELD: Object.freeze({
    PREMERGE_EVIDENCE_INVALID: null,
    PREMERGE_AUTHORITY_UNAVAILABLE: null,
    POLICY_OR_SETTINGS_DRIFT: null,
    MERGE_OUTCOME_UNVERIFIED: ['reconciliation'],
    DELIVERY_PENDING_FIXPOINT: ['reconciliation'],
    DEPLOYMENT_BLOCKED: [],
    ACTIVATION_UNATTESTED: [],
  }),
})

class SingleFlightLedger {
  constructor(repository, active = null, history = [], openRecovery = null) {
    this.repository = repository
    this.active = active
    this.history = history
    // Terminal history is separate from the active lease: a FAILED/HELD closure
    // releases the lock but leaves a bound recovery lineage open.
    this.openRecovery = openRecovery
    Object.freeze(this.history)
    Object.freeze(this)
  }

  acquire({ deliveryId, prClass, supersedesDeliveryId = null } = {}) {
    assertIdentifier(deliveryId, 'delivery_lock_invalid', 'delivery_id_invalid')
    if (!DELIVERY_LOCK_CLASSES.includes(prClass)) fail('delivery_lock_invalid', 'pr_class_invalid')
    if (this.active !== null) fail('delivery_lock_held', 'repository_delivery_is_single_flight')
    if (this.history.some((event) => event.deliveryId === deliveryId)) {
      fail('delivery_lock_invalid', 'delivery_id_already_terminal')
    }
    if (this.openRecovery === null) {
      if (RECOVERY_CLASSES.has(prClass) || supersedesDeliveryId !== null) {
        fail('delivery_lock_invalid', 'recovery_lane_requires_bound_terminal_lineage')
      }
    } else {
      const lanes = RECOVERY_LANES[this.openRecovery.terminalClass][this.openRecovery.reasonCode]
      if (!lanes.includes(prClass)) {
        fail('delivery_lock_frozen', `queue_frozen_until_${this.openRecovery.deliveryId}_is_recovered`)
      }
      if (supersedesDeliveryId !== this.openRecovery.deliveryId) {
        fail('delivery_lock_invalid', 'recovery_must_bind_exact_terminal_delivery_id')
      }
    }
    const lease = deepFreeze({ repository: this.repository, deliveryId, prClass, supersedesDeliveryId })
    return { ledger: new SingleFlightLedger(this.repository, lease, this.history, this.openRecovery), lease }
  }

  close({ deliveryId, terminalClass, reasonCode } = {}) {
    if (this.active === null || this.active.deliveryId !== deliveryId) {
      fail('delivery_lock_invalid', 'delivery_does_not_hold_lock')
    }
    if (!TERMINAL_REASONS[terminalClass]?.includes(reasonCode)) fail('delivery_lock_invalid', 'terminal_mapping_invalid')
    const event = deepFreeze({ ...this.active, terminalClass, reasonCode })
    const history = [...this.history, event]
    if (terminalClass === 'DELIVERED') return new SingleFlightLedger(this.repository, null, history, null)
    const lanes = RECOVERY_LANES[terminalClass][reasonCode]
    // A pre-merge HELD merged nothing: it never opens a lineage of its own, and it
    // must not release a lineage that an earlier non-delivered terminal left open.
    if (lanes === null) return new SingleFlightLedger(this.repository, null, history, this.openRecovery)
    return new SingleFlightLedger(this.repository, null, history, event)
  }

  // The only exit from a frozen queue with no autonomous lane: an audited,
  // authority-bearing user-initiated transaction that names the exact terminal.
  unfreeze({ deliveryId, authorityRef } = {}) {
    if (this.active !== null) fail('delivery_lock_held', 'repository_delivery_is_single_flight')
    if (this.openRecovery === null || this.openRecovery.deliveryId !== deliveryId) {
      fail('delivery_lock_invalid', 'unfreeze_must_name_open_terminal_delivery')
    }
    assertIdentifier(authorityRef, 'delivery_lock_invalid', 'unfreeze_authority_ref_invalid')
    const event = deepFreeze({
      repository: this.repository,
      deliveryId,
      prClass: this.openRecovery.prClass,
      supersedesDeliveryId: this.openRecovery.supersedesDeliveryId,
      terminalClass: this.openRecovery.terminalClass,
      reasonCode: this.openRecovery.reasonCode,
      unfrozenBy: authorityRef,
    })
    return new SingleFlightLedger(this.repository, null, [...this.history, event], null)
  }
}

export function createSingleFlightLedger(repository) {
  if (typeof repository !== 'string' || !SAFE_REPOSITORY.test(repository)) {
    fail('delivery_lock_invalid', 'repository_invalid')
  }
  return new SingleFlightLedger(repository)
}

export function validateTrustRootDescriptor(descriptor) {
  const keys = [
    'schemaVersion', 'appId', 'issuerId', 'keyIds', 'rotation', 'credentialTtlSeconds',
    'artifactAcl', 'retention', 'egress', 'quotas',
  ]
  exactKeys(descriptor, keys, 'trust_root_descriptor_invalid', 'descriptor_shape_invalid')
  if (
    descriptor.schemaVersion !== 'autonomous-delivery-trust-root/v1' ||
    !Number.isSafeInteger(descriptor.appId) || descriptor.appId < 1 ||
    descriptor.rotation !== 'add_before_remove' ||
    descriptor.artifactAcl !== 'issuer_and_executor' ||
    descriptor.egress !== 'deny_by_default' ||
    !['delivery_30d', 'audit_1y'].includes(descriptor.retention) ||
    !Number.isSafeInteger(descriptor.credentialTtlSeconds) || descriptor.credentialTtlSeconds < 60 ||
    descriptor.credentialTtlSeconds > 900
  ) fail('trust_root_descriptor_invalid', 'descriptor_policy_invalid')
  assertIdentifier(descriptor.issuerId, 'trust_root_descriptor_invalid', 'issuer_id_invalid')
  if (!Array.isArray(descriptor.keyIds) || descriptor.keyIds.length < 1 || descriptor.keyIds.length > 8) {
    fail('trust_root_descriptor_invalid', 'key_ids_invalid')
  }
  descriptor.keyIds.forEach((keyId) => assertIdentifier(keyId, 'trust_root_descriptor_invalid', 'key_id_invalid'))
  exactKeys(
    descriptor.quotas,
    ['cpuSeconds', 'wallSeconds', 'memoryMb', 'outputBytes'],
    'trust_root_descriptor_invalid',
    'quota_shape_invalid',
  )
  for (const [key, value] of Object.entries(descriptor.quotas)) {
    if (!Number.isSafeInteger(value) || value < 1) fail('trust_root_descriptor_invalid', `quota_${key}_invalid`)
  }
  try {
    assertNoSecretShape(descriptor)
  } catch {
    fail('trust_root_descriptor_invalid', 'descriptor_contains_secret_field_or_value')
  }
  return deepFreeze(clone(descriptor))
}

export function validateActivationPlan(plan) {
  exactKeys(plan, [
    'schemaVersion', 'phase', 'sinkEnabled', 'commandId', 'authorityId',
    'preStateSha256', 'expectedObservationSha256', 'artifactSchemaId', 'rollbackCommandId',
  ], 'activation_plan_invalid', 'activation_plan_shape_invalid')
  if (
    plan.schemaVersion !== 'autonomous-delivery-activation-plan/v1' ||
    !['LEGACY_GUARDED', 'SHADOW_DUAL', 'CUTOVER_ARMED', 'CANARY_ACTIVE', 'AUTONOMOUS_ACTIVE'].includes(plan.phase) ||
    typeof plan.sinkEnabled !== 'boolean'
  ) fail('activation_plan_invalid', 'activation_plan_policy_invalid')
  if (['LEGACY_GUARDED', 'SHADOW_DUAL', 'CUTOVER_ARMED'].includes(plan.phase) && plan.sinkEnabled) {
    fail('activation_plan_invalid', 'sink_must_remain_disabled_before_canary')
  }
  for (const key of ['commandId', 'authorityId', 'artifactSchemaId', 'rollbackCommandId']) {
    assertIdentifier(plan[key], 'activation_plan_invalid', `${key}_invalid`)
  }
  assertSha256(plan.preStateSha256, 'activation_plan_invalid', 'pre_state_digest_invalid')
  assertSha256(plan.expectedObservationSha256, 'activation_plan_invalid', 'observation_digest_invalid')
  try {
    assertNoSecretShape(plan)
  } catch {
    fail('activation_plan_invalid', 'activation_plan_contains_secret')
  }
  return deepFreeze(clone(plan))
}

const BLOCKING_FINDING_SEVERITIES = new Set(['P0', 'P1', 'P2', 'BLOCKER', 'CRITICAL', 'HIGH'])
const NON_BLOCKING_FINDING_SEVERITIES = new Set(['P3', 'MEDIUM', 'LOW', 'ADVISORY'])
const FINDING_SOURCES = new Set(['ci', 'reviewer', 'human', 'deterministic'])
const FINDING_VERIFICATIONS = new Set(['confirmed', 'refuted', 'unverified'])
// Closed Review Disposition vocabulary. Legacy values are accepted on input and
// normalized so an older packet cannot smuggle an unknown state past the gate.
export const REVIEW_DISPOSITIONS = Object.freeze(['ACCEPTED', 'FIX_REQUIRED', 'FALSE_POSITIVE', 'DEFERRED', 'ESCALATE'])
const LEGACY_FINDING_DISPOSITIONS = Object.freeze({
  FIX: 'FIX_REQUIRED', REJECT: 'FALSE_POSITIVE', ACCEPT_RISK: 'ACCEPTED', DEFER: 'DEFERRED',
})
export const FINDING_RISK_CLASSES = Object.freeze([
  'contract_integrity', 'correctness', 'test_coverage', 'documentation', 'operability',
  'security', 'acl', 'architecture', 'schema_migration', 'deployment', 'production', 'credentials',
])
// High-risk classes never autonomous-merge: only ESCALATE, or FALSE_POSITIVE with
// reproducible counter-evidence, may close them.
export const HIGH_RISK_FINDING_CLASSES = Object.freeze([
  'security', 'acl', 'architecture', 'schema_migration', 'deployment', 'production', 'credentials',
])
const FOLLOW_UP_ISSUE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/u
const EVIDENCE_LOCATION = /^[^\r\n:][^\r\n]*:[1-9][0-9]*$/u
const parseTimestamp = (value) => (typeof value === 'string' ? Date.parse(value) : NaN)

export function normalizeFindingDisposition(value) {
  if (REVIEW_DISPOSITIONS.includes(value)) return value
  if (typeof value === 'string' && Object.hasOwn(LEGACY_FINDING_DISPOSITIONS, value)) {
    return LEGACY_FINDING_DISPOSITIONS[value]
  }
  fail('finding_disposition_invalid', 'disposition_not_closed')
}

const validateEvidenceLocations = (evidence, label) => {
  if (!Array.isArray(evidence) || evidence.length < 1 || evidence.length > 8) {
    fail('finding_disposition_incomplete', `${label}_evidence_missing_or_unbounded`)
  }
  if (evidence.some((reference) => (
    typeof reference !== 'string' || reference.length > 240 || !EVIDENCE_LOCATION.test(reference)
  ))) fail('finding_disposition_invalid', `${label}_evidence_not_reproducible`)
  try {
    assertNoSecretShape(evidence)
  } catch {
    fail('finding_disposition_invalid', `${label}_evidence_contains_secret`)
  }
}

const sameRepositoryIssue = (value, repository) => (
  typeof value === 'string' && FOLLOW_UP_ISSUE.test(value) &&
  value.startsWith(`https://github.com/${repository}/issues/`)
)

const FINDING_KEYS = Object.freeze([
  'id', 'threadId', 'source', 'severity', 'verification', 'inScope', 'riskClass', 'disposition',
  'fixedOnHead', 'fixEvidence', 'evidence', 'policyRule', 'followUpRef', 'threadResolved',
])

// A "fixed" claim is never self-certifying: it must name the repair head, a
// reproducible regression location, and the independent re-review that examined it.
const validateFixEvidence = (fixEvidence, label, headOid) => {
  exactKeys(fixEvidence, ['repairHeadOid', 'regressionEvidence', 'reReviewRef'], 'finding_disposition_invalid', `${label}_fix_evidence_shape_invalid`)
  assertSha1(fixEvidence.repairHeadOid, 'finding_disposition_invalid', `${label}_repair_head_invalid`)
  if (headOid !== null && fixEvidence.repairHeadOid !== headOid) {
    fail('finding_disposition_invalid', `${label}_fix_not_on_current_head`)
  }
  validateEvidenceLocations(fixEvidence.regressionEvidence, `${label}_regression`)
  assertIdentifier(fixEvidence.reReviewRef, 'finding_disposition_invalid', `${label}_independent_rereview_ref_invalid`)
}

export function validateFindingDisposition(findingRaw, label, repository, { headOid = null, converged = true } = {}) {
  exactKeys(findingRaw, FINDING_KEYS, 'finding_disposition_invalid', `${label}_shape_invalid`)
  const finding = { ...clone(findingRaw), disposition: normalizeFindingDisposition(findingRaw.disposition) }
  assertIdentifier(finding.id, 'finding_disposition_invalid', `${label}_id_invalid`)
  assertIdentifier(finding.threadId, 'finding_disposition_invalid', `${label}_thread_id_invalid`)
  if (!FINDING_SOURCES.has(finding.source)) fail('finding_disposition_invalid', `${label}_source_invalid`)
  if (!BLOCKING_FINDING_SEVERITIES.has(finding.severity) && !NON_BLOCKING_FINDING_SEVERITIES.has(finding.severity)) {
    fail('finding_disposition_invalid', `${label}_severity_invalid`)
  }
  if (!FINDING_VERIFICATIONS.has(finding.verification)) {
    fail('finding_disposition_invalid', `${label}_verification_invalid`)
  }
  if (!FINDING_RISK_CLASSES.includes(finding.riskClass)) fail('finding_disposition_invalid', `${label}_risk_class_invalid`)
  if (typeof finding.inScope !== 'boolean' || typeof finding.fixedOnHead !== 'boolean' || typeof finding.threadResolved !== 'boolean') {
    fail('finding_disposition_invalid', `${label}_boolean_invalid`)
  }
  assertIdentifier(finding.policyRule, 'finding_disposition_invalid', `${label}_policy_rule_invalid`)
  validateEvidenceLocations(finding.evidence, label)
  if (finding.fixEvidence !== null) validateFixEvidence(finding.fixEvidence, label, headOid)

  const { disposition, verification, severity } = finding
  const blocking = BLOCKING_FINDING_SEVERITIES.has(severity)
  if (disposition !== 'ESCALATE' && verification === 'unverified') {
    fail('finding_disposition_incomplete', `${label}_verification_incomplete`)
  }
  if (
    HIGH_RISK_FINDING_CLASSES.includes(finding.riskClass) && disposition !== 'ESCALATE' &&
    !(disposition === 'FALSE_POSITIVE' && verification === 'refuted')
  ) fail('finding_disposition_invalid', `${label}_high_risk_finding_requires_escalation`)

  if (disposition === 'FIX_REQUIRED') {
    if (verification !== 'confirmed' || !finding.inScope || finding.followUpRef !== null) {
      fail('finding_disposition_invalid', `${label}_fix_contract_invalid`)
    }
    if (finding.fixedOnHead && finding.fixEvidence === null) {
      fail('finding_disposition_invalid', `${label}_fix_claim_without_regression_and_rereview_evidence`)
    }
    if (!finding.fixedOnHead && finding.fixEvidence !== null) {
      fail('finding_disposition_invalid', `${label}_fix_evidence_without_fixed_head`)
    }
    if (!finding.fixedOnHead && converged) fail('finding_disposition_incomplete', `${label}_fix_required_pending_repair`)
  } else if (disposition === 'FALSE_POSITIVE') {
    if (verification !== 'refuted' || finding.fixedOnHead || finding.fixEvidence !== null || finding.followUpRef !== null) {
      fail('finding_disposition_invalid', `${label}_false_positive_contract_invalid`)
    }
  } else if (disposition === 'ACCEPTED') {
    if (verification !== 'confirmed' || finding.followUpRef !== null) {
      fail('finding_disposition_invalid', `${label}_accepted_contract_invalid`)
    }
    // "Already addressed on this head" is a fix claim and carries the same
    // evidentiary bar as FIX_REQUIRED; a bare boolean never proves it.
    if (finding.fixedOnHead && finding.fixEvidence === null) {
      fail('finding_disposition_invalid', `${label}_accepted_fix_claim_without_regression_and_rereview_evidence`)
    }
    if (!finding.fixedOnHead && finding.fixEvidence !== null) {
      fail('finding_disposition_invalid', `${label}_fix_evidence_without_fixed_head`)
    }
  } else if (disposition === 'DEFERRED') {
    if (
      verification !== 'confirmed' || finding.inScope || finding.fixedOnHead || finding.fixEvidence !== null ||
      !sameRepositoryIssue(finding.followUpRef, repository)
    ) fail('finding_disposition_invalid', `${label}_defer_contract_invalid`)
  } else {
    if (finding.fixedOnHead || finding.fixEvidence !== null) fail('finding_disposition_invalid', `${label}_escalate_cannot_claim_fix`)
    if (finding.followUpRef !== null && !sameRepositoryIssue(finding.followUpRef, repository)) {
      fail('finding_disposition_invalid', `${label}_escalate_follow_up_invalid`)
    }
    if (finding.threadResolved) fail('finding_disposition_invalid', `${label}_escalated_thread_must_stay_open`)
  }
  // A confirmed in-scope blocker only leaves the gate through a verified fix on the
  // current head (FIX_REQUIRED, or ACCEPTED with the same fix evidence because a
  // prior commit on this head already addressed it) or by escalating outside
  // autonomous authority. A bare `fixedOnHead` boolean is never enough.
  if (verification === 'confirmed' && finding.inScope && blocking && !(
    disposition === 'ESCALATE' || disposition === 'FIX_REQUIRED' ||
    (disposition === 'ACCEPTED' && finding.fixedOnHead && finding.fixEvidence !== null)
  )) fail('finding_disposition_invalid', `${label}_blocking_finding_requires_fix`)
  if (converged && disposition !== 'ESCALATE' && !finding.threadResolved) {
    fail('finding_disposition_incomplete', `${label}_thread_not_resolved_after_disposition`)
  }
  return finding
}

const MACHINE_GATE_KEYS = Object.freeze([
  'name', 'appId', 'conclusion', 'headOid', 'checkRunId', 'startedAt', 'completedAt',
])

// The gate binds to the authoritative latest CheckRun of the expected source on the
// frozen head, and that run must have started after finding convergence was
// observed. Both the complete same-head run list and the convergence epoch come
// from the trusted collector (outside the candidate bundle), never from the bundle
// itself, so neither can be self-reported to satisfy the ordering check.
const validateMachineGateEpoch = (gate, expectedSource, { convergenceObservedAt, sameHeadCheckRuns } = {}) => {
  exactKeys(gate, MACHINE_GATE_KEYS, 'finding_gate_order_invalid', 'machine_gate_shape_invalid')
  if (!Number.isSafeInteger(gate.checkRunId) || gate.checkRunId < 1) {
    fail('finding_gate_order_invalid', 'machine_gate_check_run_id_invalid')
  }
  const started = parseTimestamp(gate.startedAt)
  const completed = parseTimestamp(gate.completedAt)
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    fail('finding_gate_order_invalid', 'machine_gate_timestamps_invalid')
  }
  const epoch = parseTimestamp(convergenceObservedAt)
  if (!Number.isFinite(epoch)) fail('finding_gate_order_invalid', 'collector_convergence_epoch_required')
  if (!Array.isArray(sameHeadCheckRuns) || sameHeadCheckRuns.length < 1 || sameHeadCheckRuns.length > 64) {
    fail('finding_gate_order_invalid', 'collector_same_head_check_runs_required')
  }
  const seen = new Set()
  let latest = null
  for (const [index, run] of sameHeadCheckRuns.entries()) {
    exactKeys(run, ['id', 'name', 'appId', 'headOid', 'conclusion', 'startedAt', 'completedAt'], 'finding_gate_order_invalid', `same_head_check_run_${index}_shape_invalid`)
    if (!Number.isSafeInteger(run.id) || run.id < 1 || seen.has(run.id)) {
      fail('finding_gate_order_invalid', `same_head_check_run_${index}_id_invalid`)
    }
    if (run.name !== expectedSource.name || run.appId !== expectedSource.appId || run.headOid !== expectedSource.headOid) {
      fail('finding_gate_order_invalid', `same_head_check_run_${index}_not_expected_source_on_head`)
    }
    seen.add(run.id)
    if (latest === null || run.id > latest.id) latest = run
  }
  if (latest.id !== gate.checkRunId) fail('finding_gate_order_invalid', 'machine_gate_not_latest_same_head_check_run')
  if (latest.conclusion !== gate.conclusion || latest.startedAt !== gate.startedAt || latest.completedAt !== gate.completedAt) {
    fail('finding_gate_order_invalid', 'machine_gate_does_not_match_latest_check_run')
  }
  if (started < epoch) fail('finding_gate_order_invalid', 'machine_gate_started_before_finding_convergence')
}

// The complete finding identity set observed by the collector, supplied from
// outside the candidate bundle. The dispositioned set must equal it exactly, so a
// bundle cannot omit a blocking finding and still converge.
const parseCollectedFindings = (collectedFindings) => {
  if (!Array.isArray(collectedFindings) || collectedFindings.length > 256) {
    fail('finding_disposition_incomplete', 'collector_finding_set_required')
  }
  const ids = new Set()
  const threads = new Set()
  for (const [index, entry] of collectedFindings.entries()) {
    exactKeys(entry, ['id', 'threadId'], 'finding_disposition_invalid', `collected_finding_${index}_shape_invalid`)
    assertIdentifier(entry.id, 'finding_disposition_invalid', `collected_finding_${index}_id_invalid`)
    assertIdentifier(entry.threadId, 'finding_disposition_invalid', `collected_finding_${index}_thread_id_invalid`)
    if (ids.has(entry.id) || threads.has(entry.threadId)) {
      fail('finding_disposition_invalid', `collected_finding_${index}_duplicated`)
    }
    ids.add(entry.id)
    threads.add(entry.threadId)
  }
  return { ids, threads }
}

export function validateFindingDispositionBundle(bundle, expectedRequiredCheckSource, {
  collectedFindings, convergenceObservedAt, sameHeadCheckRuns,
} = {}) {
  exactKeys(bundle, [
    'schemaVersion', 'repository', 'prNumber', 'baseOid', 'headOid', 'policySha256',
    'threadsComplete', 'unresolvedThreads', 'machineGate', 'findings',
  ], 'finding_disposition_invalid', 'bundle_shape_invalid')
  if (
    bundle.schemaVersion !== 'autonomous-delivery-finding-disposition/v1' ||
    !SAFE_REPOSITORY.test(bundle.repository) ||
    !Number.isSafeInteger(bundle.prNumber) || bundle.prNumber < 1
  ) fail('finding_disposition_invalid', 'bundle_identity_invalid')
  assertSha1(bundle.baseOid, 'finding_disposition_invalid', 'bundle_base_invalid')
  assertSha1(bundle.headOid, 'finding_disposition_invalid', 'bundle_head_invalid')
  assertSha256(bundle.policySha256, 'finding_disposition_invalid', 'bundle_policy_digest_invalid')
  if (typeof bundle.threadsComplete !== 'boolean' || !Number.isSafeInteger(bundle.unresolvedThreads) || bundle.unresolvedThreads < 0) {
    fail('finding_disposition_invalid', 'conversation_state_invalid')
  }
  if (!Array.isArray(bundle.findings) || bundle.findings.length > 256) {
    fail('finding_disposition_invalid', 'finding_registry_unbounded')
  }
  exactKeys(expectedRequiredCheckSource, ['name', 'appId'], 'finding_gate_order_invalid', 'required_check_source_shape_invalid')
  assertIdentifier(expectedRequiredCheckSource.name, 'finding_gate_order_invalid', 'required_check_source_name_invalid')
  if (!Number.isSafeInteger(expectedRequiredCheckSource.appId) || expectedRequiredCheckSource.appId < 1) {
    fail('finding_gate_order_invalid', 'required_check_source_app_invalid')
  }
  const findings = bundle.findings.map((finding, index) => validateFindingDisposition(
    finding, `finding_${index}`, bundle.repository, { headOid: bundle.headOid, converged: true },
  ))
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length ||
      new Set(findings.map((finding) => finding.threadId)).size !== findings.length) {
    fail('finding_disposition_invalid', 'finding_or_thread_identity_duplicated')
  }
  const collected = parseCollectedFindings(collectedFindings)
  if (
    collected.ids.size !== findings.length ||
    findings.some((finding) => !collected.ids.has(finding.id) || !collected.threads.has(finding.threadId))
  ) fail('finding_disposition_incomplete', 'dispositions_do_not_cover_complete_collected_finding_set')
  if (findings.some((finding) => finding.disposition === 'ESCALATE')) {
    // Escalation removes the PR from autonomous authority regardless of any gate.
    return deepFreeze({ ...clone(bundle), findings, reviewConverged: false, status: 'escalated' })
  }
  if (!bundle.threadsComplete || bundle.unresolvedThreads !== 0) {
    fail('finding_disposition_incomplete', 'server_conversation_collection_not_converged')
  }

  if (bundle.machineGate === null) {
    return deepFreeze({ ...clone(bundle), findings, reviewConverged: true, status: 'held' })
  }
  validateMachineGateEpoch(bundle.machineGate, {
    name: expectedRequiredCheckSource.name, appId: expectedRequiredCheckSource.appId, headOid: bundle.headOid,
  }, { convergenceObservedAt, sameHeadCheckRuns })
  validateSourcePinnedRequiredCheck({
    name: bundle.machineGate.name,
    appId: bundle.machineGate.appId,
    headOid: bundle.machineGate.headOid,
    conclusion: bundle.machineGate.conclusion,
  }, {
    name: expectedRequiredCheckSource.name,
    appId: expectedRequiredCheckSource.appId,
    headOid: bundle.headOid,
  })
  return deepFreeze({ ...clone(bundle), findings, reviewConverged: true, status: 'passed' })
}

const sortedUniqueNumbers = (values) => [...new Set(values)].sort((left, right) => left - right)

// Server-derived dependency graph supplied separately from the subagent plan. The
// plan's digest must equal this graph's canonical digest, every predecessor set is
// compared as a complete edge set (skipped PRs re-pointed to their subsumer), and
// every proof digest must be recomputable from the bound tuple.
const parseAuthoritativeDependencies = (authoritativeDependencies) => {
  if (!Array.isArray(authoritativeDependencies) || authoritativeDependencies.length < 1 || authoritativeDependencies.length > 200) {
    fail('merge_plan_dependency_invalid', 'authoritative_dependency_graph_missing_or_unbounded')
  }
  const graph = new Map()
  for (const [index, entry] of authoritativeDependencies.entries()) {
    exactKeys(entry, ['prNumber', 'headOid', 'predecessorPrNumbers'], 'merge_plan_dependency_invalid', `authoritative_dependency_${index}_shape_invalid`)
    if (!Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1 || graph.has(entry.prNumber)) {
      fail('merge_plan_dependency_invalid', `authoritative_dependency_${index}_identity_invalid`)
    }
    assertSha1(entry.headOid, 'merge_plan_dependency_invalid', `authoritative_dependency_${index}_head_invalid`)
    if (!Array.isArray(entry.predecessorPrNumbers) || entry.predecessorPrNumbers.length > 32 ||
        entry.predecessorPrNumbers.some((prNumber) => !Number.isSafeInteger(prNumber) || prNumber < 1 || prNumber === entry.prNumber)) {
      fail('merge_plan_dependency_invalid', `authoritative_dependency_${index}_edges_invalid`)
    }
    graph.set(entry.prNumber, { headOid: entry.headOid, predecessorPrNumbers: sortedUniqueNumbers(entry.predecessorPrNumbers) })
  }
  for (const [prNumber, entry] of graph) {
    if (entry.predecessorPrNumbers.some((predecessor) => !graph.has(predecessor))) {
      fail('merge_plan_dependency_invalid', `authoritative_dependency_${prNumber}_references_unknown_pr`)
    }
  }
  const canonicalGraph = [...graph.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([prNumber, entry]) => ({ prNumber, headOid: entry.headOid, predecessorPrNumbers: entry.predecessorPrNumbers }))
  return { graph, digest: canonicalSha256(canonicalGraph) }
}

export function mergeOrderDependencyProof({ prNumber, headOid, predecessorPrNumbers, dependencyGraphSha256 }) {
  return canonicalSha256({ prNumber, headOid, predecessorPrNumbers: sortedUniqueNumbers(predecessorPrNumbers), dependencyGraphSha256 })
}

export function subsumptionProof({ prNumber, headOid, subsumedByPrNumber, subsumedByHeadOid }) {
  return canonicalSha256({ kind: 'SKIP_SUBSUMED', prNumber, headOid, subsumedByPrNumber, subsumedByHeadOid })
}

export function validateSubagentMergePlan(plan, {
  observedPrs, verifyProvenance, authoritativeDependencies, verifySubsumption,
} = {}) {
  exactKeys(plan, [
    'schemaVersion', 'repository', 'baseOid', 'policySha256', 'dependencyGraphSha256',
    'generatedBy', 'mergeOrder', 'skips',
  ], 'merge_plan_invalid', 'merge_plan_shape_invalid')
  if (plan.schemaVersion !== 'autonomous-delivery-subagent-merge-plan/v1' || !SAFE_REPOSITORY.test(plan.repository)) {
    fail('merge_plan_invalid', 'merge_plan_identity_invalid')
  }
  assertSha1(plan.baseOid, 'merge_plan_invalid', 'merge_plan_base_invalid')
  assertSha256(plan.policySha256, 'merge_plan_invalid', 'merge_plan_policy_invalid')
  assertSha256(plan.dependencyGraphSha256, 'merge_plan_invalid', 'dependency_graph_digest_invalid')
  exactKeys(plan.generatedBy, [
    'kind', 'taskId', 'model', 'resultArtifactSha256',
  ], 'merge_plan_authority_invalid', 'merge_plan_author_shape_invalid')
  if (plan.generatedBy.kind !== 'subagent') {
    fail('merge_plan_authority_invalid', 'merge_order_must_be_subagent_authored')
  }
  assertIdentifier(plan.generatedBy.taskId, 'merge_plan_authority_invalid', 'subagent_task_id_invalid')
  assertIdentifier(plan.generatedBy.model, 'merge_plan_authority_invalid', 'subagent_model_invalid')
  assertSha256(plan.generatedBy.resultArtifactSha256, 'merge_plan_authority_invalid', 'subagent_result_artifact_invalid')
  if (!Array.isArray(plan.mergeOrder) || plan.mergeOrder.length < 1 || plan.mergeOrder.length > 100) {
    fail('merge_plan_invalid', 'merge_order_missing_or_unbounded')
  }
  if (!Array.isArray(observedPrs) || typeof verifyProvenance !== 'function' || typeof verifySubsumption !== 'function') {
    fail('merge_plan_authority_invalid', 'authenticated_subagent_provenance_server_observations_and_subsumption_verifier_required')
  }
  const { graph, digest: authoritativeDigest } = parseAuthoritativeDependencies(authoritativeDependencies)
  if (plan.dependencyGraphSha256 !== authoritativeDigest) {
    fail('merge_plan_dependency_invalid', 'dependency_graph_digest_not_authoritative')
  }
  if (!Array.isArray(plan.skips) || plan.skips.length > 100) {
    fail('merge_plan_skip_invalid', 'skip_registry_unbounded')
  }
  const plannedMergeNumbers = new Set(plan.mergeOrder.map((entry) => (isPlainObject(entry) ? entry.prNumber : null)))
  const skipTargets = new Map()
  for (const [index, entry] of plan.skips.entries()) {
    exactKeys(entry, [
      'prNumber', 'headOid', 'disposition', 'subsumedByPrNumber', 'proofSha256',
    ], 'merge_plan_skip_invalid', `skip_${index}_shape_invalid`)
    if (!Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1 || skipTargets.has(entry.prNumber) ||
        !Number.isSafeInteger(entry.subsumedByPrNumber) || entry.subsumedByPrNumber === entry.prNumber ||
        !plannedMergeNumbers.has(entry.subsumedByPrNumber)) {
      fail('merge_plan_skip_invalid', `skip_${index}_lineage_invalid`)
    }
    skipTargets.set(entry.prNumber, entry.subsumedByPrNumber)
  }

  const seen = new Map()
  const mergeOrder = plan.mergeOrder.map((entry, index) => {
    exactKeys(entry, [
      'prNumber', 'headOid', 'predecessorPrNumbers', 'dependencyProofSha256',
    ], 'merge_plan_invalid', `merge_order_${index}_shape_invalid`)
    if (!Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1 || seen.has(entry.prNumber) || skipTargets.has(entry.prNumber)) {
      fail('merge_plan_invalid', `merge_order_${index}_pr_invalid`)
    }
    assertSha1(entry.headOid, 'merge_plan_invalid', `merge_order_${index}_head_invalid`)
    assertSha256(entry.dependencyProofSha256, 'merge_plan_invalid', `merge_order_${index}_proof_invalid`)
    if (!Array.isArray(entry.predecessorPrNumbers) || entry.predecessorPrNumbers.length > 32 ||
        new Set(entry.predecessorPrNumbers).size !== entry.predecessorPrNumbers.length ||
        entry.predecessorPrNumbers.some((prNumber) => !Number.isSafeInteger(prNumber) || !seen.has(prNumber))) {
      fail('merge_plan_dependency_invalid', `merge_order_${index}_predecessor_not_earlier`)
    }
    const authority = graph.get(entry.prNumber)
    if (!authority || authority.headOid !== entry.headOid) {
      fail('merge_plan_dependency_invalid', `merge_order_${index}_not_in_authoritative_graph`)
    }
    const declared = sortedUniqueNumbers(entry.predecessorPrNumbers)
    const expected = sortedUniqueNumbers(
      authority.predecessorPrNumbers.map((predecessor) => skipTargets.get(predecessor) ?? predecessor)
        .filter((predecessor) => predecessor !== entry.prNumber),
    )
    if (declared.join(',') !== expected.join(',')) {
      fail('merge_plan_dependency_invalid', `merge_order_${index}_predecessors_not_authoritative`)
    }
    if (entry.dependencyProofSha256 !== mergeOrderDependencyProof({
      prNumber: entry.prNumber, headOid: entry.headOid, predecessorPrNumbers: declared,
      dependencyGraphSha256: plan.dependencyGraphSha256,
    })) fail('merge_plan_dependency_invalid', `merge_order_${index}_proof_not_recomputable`)
    seen.set(entry.prNumber, entry.headOid)
    return clone(entry)
  })

  const skips = plan.skips.map((entry, index) => {
    if (entry.disposition !== 'SKIP_SUBSUMED' || !seen.has(entry.subsumedByPrNumber)) {
      fail('merge_plan_skip_invalid', `skip_${index}_lineage_invalid`)
    }
    assertSha1(entry.headOid, 'merge_plan_skip_invalid', `skip_${index}_head_invalid`)
    assertSha256(entry.proofSha256, 'merge_plan_skip_invalid', `skip_${index}_proof_invalid`)
    const authority = graph.get(entry.prNumber)
    if (!authority || authority.headOid !== entry.headOid) {
      fail('merge_plan_skip_invalid', `skip_${index}_not_in_authoritative_graph`)
    }
    const subsumedByHeadOid = seen.get(entry.subsumedByPrNumber)
    if (entry.proofSha256 !== subsumptionProof({
      prNumber: entry.prNumber, headOid: entry.headOid,
      subsumedByPrNumber: entry.subsumedByPrNumber, subsumedByHeadOid,
    })) fail('merge_plan_skip_invalid', `skip_${index}_proof_not_recomputable`)
    let subsumptionVerified = false
    try {
      subsumptionVerified = verifySubsumption(deepFreeze({
        prNumber: entry.prNumber, headOid: entry.headOid,
        subsumedByPrNumber: entry.subsumedByPrNumber, subsumedByHeadOid, proofSha256: entry.proofSha256,
      })) === true
    } catch {
      subsumptionVerified = false
    }
    if (!subsumptionVerified) fail('merge_plan_skip_invalid', `skip_${index}_subsumption_unverified`)
    return clone(entry)
  })
  const plannedEntries = [...mergeOrder, ...skips]
  if (graph.size !== plannedEntries.length) {
    fail('merge_plan_dependency_invalid', 'authoritative_graph_scope_mismatch')
  }
  if (observedPrs.length !== plannedEntries.length) {
    fail('merge_plan_observation_invalid', 'server_observation_scope_mismatch')
  }
  const observations = new Map()
  for (const [index, observation] of observedPrs.entries()) {
    exactKeys(observation, ['prNumber', 'headOid'], 'merge_plan_observation_invalid', `observation_${index}_shape_invalid`)
    if (!Number.isSafeInteger(observation.prNumber) || observation.prNumber < 1 || observations.has(observation.prNumber)) {
      fail('merge_plan_observation_invalid', `observation_${index}_identity_invalid`)
    }
    assertSha1(observation.headOid, 'merge_plan_observation_invalid', `observation_${index}_head_invalid`)
    observations.set(observation.prNumber, observation.headOid)
  }
  for (const entry of plannedEntries) {
    if (!observations.has(entry.prNumber)) {
      fail('merge_plan_observation_invalid', `pr_${entry.prNumber}_server_observation_missing`)
    }
    if (observations.get(entry.prNumber) !== entry.headOid) {
      fail('merge_plan_head_drift', `pr_${entry.prNumber}_head_changed_after_plan`)
    }
  }
  const canonicalPlan = { ...clone(plan), mergeOrder, skips }
  let authorityVerified = false
  try {
    authorityVerified = verifyProvenance(deepFreeze({
      repository: plan.repository,
      baseOid: plan.baseOid,
      policySha256: plan.policySha256,
      dependencyGraphSha256: plan.dependencyGraphSha256,
      generatedBy: clone(plan.generatedBy),
      contentSha256: canonicalSha256(canonicalPlan),
      observedPrsSha256: canonicalSha256(observedPrs),
    })) === true
  } catch {
    authorityVerified = false
  }
  if (!authorityVerified) {
    fail('merge_plan_authority_invalid', 'subagent_provenance_attestation_failed')
  }
  return deepFreeze({ ...canonicalPlan, authorityVerified: true })
}

// ---------------------------------------------------------------------------
// Review Disposition Agent — an extension of the merge-queue agent, not a second
// pipeline. The read-only queue observer renders structured GitHub replies with
// hidden machine metadata; a separate coordinator-owned sink posts them. Every
// reply is bound to finding, exact head, agent run, sender and triggering event so
// that a repeated webhook, a re-run, or the agent's own comment can never trigger
// the same disposition twice. Nothing in this section mutates GitHub.
// ---------------------------------------------------------------------------
export const REVIEW_DISPOSITION_SCHEMA = 'ai-bim-review-disposition/v1'
const REVIEW_DISPOSITION_MARKER_ANY = /<!--\s*ai-bim-review-disposition\/v1\b/u
const REVIEW_DISPOSITION_MARKER = /<!--\s*ai-bim-review-disposition\/v1\s+(\{[^\r\n]*\})\s*-->/u
// Any body containing a reviewer-bot mention would recursively trigger that bot.
const AGENT_MENTION_TRIGGER = /@(?:codex|claude)\b/iu
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$/u
const REVIEW_DISPOSITION_METADATA_KEYS = Object.freeze([
  'schema', 'repository', 'pr_number', 'finding_id', 'thread_id', 'head_sha', 'base_sha',
  'agent_run_id', 'sender', 'webhook_event_id', 'disposition', 'severity', 'risk_class',
  'verification', 'fixed_on_head', 'evidence_sha256',
])

// Whether a thread may be resolved is derived from the metadata alone, so a
// plan file or sidecar can never assert resolvability the body does not support.
export function reviewDispositionResolvable(metadata) {
  return metadata.disposition !== 'ESCALATE' && !(metadata.disposition === 'FIX_REQUIRED' && metadata.fixed_on_head !== true)
}

const assertReplyText = (value, { min, max, detail }) => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    fail('review_disposition_invalid', detail)
  }
  if (AGENT_MENTION_TRIGGER.test(value)) fail('review_disposition_invalid', `${detail}_contains_agent_mention_trigger`)
  try {
    assertNoSecretShape(value)
  } catch {
    fail('review_disposition_invalid', `${detail}_contains_secret`)
  }
}

export function validateReviewDispositionMetadata(metadataRaw) {
  exactKeys(metadataRaw, REVIEW_DISPOSITION_METADATA_KEYS, 'review_disposition_metadata_invalid', 'metadata_shape_invalid')
  const metadata = clone(metadataRaw)
  if (
    metadata.schema !== REVIEW_DISPOSITION_SCHEMA || !SAFE_REPOSITORY.test(metadata.repository) ||
    !Number.isSafeInteger(metadata.pr_number) || metadata.pr_number < 1
  ) fail('review_disposition_metadata_invalid', 'metadata_identity_invalid')
  assertIdentifier(metadata.finding_id, 'review_disposition_metadata_invalid', 'finding_id_invalid')
  assertIdentifier(metadata.thread_id, 'review_disposition_metadata_invalid', 'thread_id_invalid')
  assertSha1(metadata.head_sha, 'review_disposition_metadata_invalid', 'head_sha_invalid')
  assertSha1(metadata.base_sha, 'review_disposition_metadata_invalid', 'base_sha_invalid')
  assertIdentifier(metadata.agent_run_id, 'review_disposition_metadata_invalid', 'agent_run_id_invalid')
  if (typeof metadata.sender !== 'string' || !GITHUB_LOGIN.test(metadata.sender)) {
    fail('review_disposition_metadata_invalid', 'sender_invalid')
  }
  assertIdentifier(metadata.webhook_event_id, 'review_disposition_metadata_invalid', 'webhook_event_id_invalid')
  if (!REVIEW_DISPOSITIONS.includes(metadata.disposition)) {
    fail('review_disposition_metadata_invalid', 'disposition_not_closed')
  }
  if (!BLOCKING_FINDING_SEVERITIES.has(metadata.severity) && !NON_BLOCKING_FINDING_SEVERITIES.has(metadata.severity)) {
    fail('review_disposition_metadata_invalid', 'severity_invalid')
  }
  if (!FINDING_RISK_CLASSES.includes(metadata.risk_class)) fail('review_disposition_metadata_invalid', 'risk_class_invalid')
  if (!FINDING_VERIFICATIONS.has(metadata.verification)) fail('review_disposition_metadata_invalid', 'verification_invalid')
  if (typeof metadata.fixed_on_head !== 'boolean') fail('review_disposition_metadata_invalid', 'fixed_on_head_invalid')
  assertSha256(metadata.evidence_sha256, 'review_disposition_metadata_invalid', 'evidence_digest_invalid')
  return deepFreeze(metadata)
}

// Full idempotency tuple: finding × exact head × agent run × sender × triggering event.
export function reviewDispositionTupleKey(metadataRaw) {
  const metadata = validateReviewDispositionMetadata(metadataRaw)
  return [
    metadata.finding_id, metadata.head_sha, metadata.agent_run_id, metadata.sender, metadata.webhook_event_id,
  ].join('|')
}

export function buildReviewDispositionReply({
  repository, prNumber, finding, headOid, baseOid, agentRunId, sender, webhookEventId,
  rationale, nextAction = null, evidenceSha256,
} = {}) {
  if (typeof repository !== 'string' || !SAFE_REPOSITORY.test(repository) || !Number.isSafeInteger(prNumber) || prNumber < 1) {
    fail('review_disposition_invalid', 'repository_or_pr_invalid')
  }
  assertSha1(headOid, 'review_disposition_invalid', 'head_oid_invalid')
  assertSha1(baseOid, 'review_disposition_invalid', 'base_oid_invalid')
  // The decision is validated against the current head but not yet converged: a
  // FIX_REQUIRED reply is posted before the repair lands and its thread stays open.
  const decision = validateFindingDisposition(finding, 'finding', repository, { headOid, converged: false })
  assertIdentifier(agentRunId, 'review_disposition_invalid', 'agent_run_id_invalid')
  if (typeof sender !== 'string' || !GITHUB_LOGIN.test(sender)) fail('review_disposition_invalid', 'sender_invalid')
  assertIdentifier(webhookEventId, 'review_disposition_invalid', 'webhook_event_id_invalid')
  assertReplyText(rationale, { min: 20, max: 4000, detail: 'rationale_invalid' })
  if (nextAction !== null) assertReplyText(nextAction, { min: 1, max: 600, detail: 'next_action_invalid' })
  assertSha256(evidenceSha256, 'review_disposition_invalid', 'evidence_digest_invalid')
  const metadata = validateReviewDispositionMetadata({
    schema: REVIEW_DISPOSITION_SCHEMA,
    repository,
    pr_number: prNumber,
    finding_id: decision.id,
    thread_id: decision.threadId,
    head_sha: headOid,
    base_sha: baseOid,
    agent_run_id: agentRunId,
    sender,
    webhook_event_id: webhookEventId,
    disposition: decision.disposition,
    severity: decision.severity,
    risk_class: decision.riskClass,
    verification: decision.verification,
    fixed_on_head: decision.fixedOnHead,
    evidence_sha256: evidenceSha256,
  })
  const codeList = (values) => values.map((value) => `\`${value}\``).join(', ')
  const lines = [
    `**Review Disposition: \`${decision.disposition}\`** — severity \`${decision.severity}\`, risk class \`${decision.riskClass}\`, verification \`${decision.verification}\`, ${decision.inScope ? 'in scope' : 'out of scope'} for this PR.`,
    '',
    rationale.trim(),
    '',
    `Evidence: ${codeList(decision.evidence)}`,
    decision.fixEvidence
      ? `Fix evidence: repair head \`${decision.fixEvidence.repairHeadOid}\`, regression ${codeList(decision.fixEvidence.regressionEvidence)}, independent re-review \`${decision.fixEvidence.reReviewRef}\``
      : null,
    decision.followUpRef ? `Follow-up: ${decision.followUpRef}` : null,
    nextAction ? `Next action: ${nextAction.trim()}` : null,
    `Bound to head \`${headOid}\` (base \`${baseOid}\`), agent run \`${agentRunId}\`, sender \`${sender}\`. This reply is disposition evidence only: it is not an approval and not merge authority, and a \`FIX_REQUIRED\` claim is satisfied only by a repair head that passes targeted tests, current-head CI and an independent re-review.`,
    '',
    `<!-- ${REVIEW_DISPOSITION_SCHEMA} ${JSON.stringify(canonicalize(metadata))} -->`,
  ].filter((line) => line !== null)
  const body = lines.join('\n')
  if (Buffer.byteLength(body, 'utf8') > 60000) fail('review_disposition_invalid', 'reply_body_too_large')
  // The assembled body is what GitHub delivers to other bots: check it as a whole,
  // not only the free-text inputs, so an evidence location cannot smuggle a mention.
  assertReplyText(body, { min: 20, max: 60000, detail: 'rendered_body_invalid' })
  return deepFreeze({ body, metadata, tupleKey: reviewDispositionTupleKey(metadata), decision })
}

// Loop guard: anything carrying the marker is agent output, never intake.
export function isAgentGeneratedComment(body) {
  return typeof body === 'string' && REVIEW_DISPOSITION_MARKER_ANY.test(body)
}

export function parseReviewDispositionMetadata(body) {
  if (typeof body !== 'string') return null
  const match = REVIEW_DISPOSITION_MARKER.exec(body)
  if (!match) {
    if (REVIEW_DISPOSITION_MARKER_ANY.test(body)) fail('review_disposition_metadata_invalid', 'metadata_marker_malformed')
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(match[1])
  } catch {
    fail('review_disposition_metadata_invalid', 'metadata_json_unparseable')
  }
  return validateReviewDispositionMetadata(parsed)
}

// A human replying to the agent may quote its reply (blockquoted marker); that is
// still human intake. An unquoted marker, or anything the agent sender wrote, is not.
const markerOutsideBlockquote = (body) => REVIEW_DISPOSITION_MARKER_ANY.test(
  body.split('\n').filter((line) => !/^\s*>/u.test(line)).join('\n'),
)

export function selectFindingIntake(comments, { agentSender = null } = {}) {
  if (!Array.isArray(comments)) fail('review_disposition_invalid', 'comments_required')
  return deepFreeze(comments
    .filter((comment) => (
      isPlainObject(comment) && typeof comment.body === 'string' &&
      !(agentSender !== null && comment.author === agentSender) &&
      !markerOutsideBlockquote(comment.body)
    ))
    .map(clone))
}

export function planReviewDispositionMutation({ existingComments, candidateMetadata } = {}) {
  const candidate = validateReviewDispositionMetadata(candidateMetadata)
  if (!Array.isArray(existingComments)) fail('review_disposition_invalid', 'existing_comments_required')
  const candidateKey = reviewDispositionTupleKey(candidate)
  for (const comment of existingComments) {
    if (!isPlainObject(comment) || typeof comment.body !== 'string') continue
    let existing = null
    try {
      existing = parseReviewDispositionMetadata(comment.body)
    } catch {
      return deepFreeze({ action: 'hold', reason: 'existing_agent_metadata_unparseable' })
    }
    if (existing === null) continue
    if (reviewDispositionTupleKey(existing) === candidateKey) {
      return deepFreeze({ action: 'skip', reason: 'duplicate_exact_tuple' })
    }
    if (
      existing.finding_id === candidate.finding_id && existing.head_sha === candidate.head_sha &&
      existing.disposition === candidate.disposition
    ) return deepFreeze({ action: 'skip', reason: 'already_dispositioned_on_head' })
  }
  return deepFreeze({ action: 'post', reason: 'new_disposition_for_finding_on_head' })
}
