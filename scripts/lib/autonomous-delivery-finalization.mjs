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
const canonicalSha256 = (value) => sha256(Buffer.from(JSON.stringify(canonicalize(value)), 'utf8'))

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
    exactKeys(
      file,
      file.status === 'renamed'
        ? ['path', 'previousPath', 'status', 'binary', 'submodule']
        : ['path', 'status', 'binary', 'submodule'],
      'unsupported_review_surface',
      `changed_file_${index}_shape_invalid`,
    )
    assertRepoPath(file.path)
    if (file.status === 'renamed') assertRepoPath(file.previousPath)
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
    file.status === 'renamed' ? [file.path, file.previousPath] : [file.path]
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

export function applyFinalizationEvent(stateRaw, event, { expectedRequiredCheckSource } = {}) {
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
    const convergence = validateFindingDispositionBundle(event.findingBundle, expectedRequiredCheckSource)
    if (
      convergence.repository !== state.repository || convergence.prNumber !== state.prNumber ||
      convergence.baseOid !== state.baseOid || convergence.headOid !== state.frozenHeadOid ||
      convergence.status !== 'passed' || convergence.reviewConverged !== true
    ) fail('finalization_event_invalid', 'round_convergence_not_bound_to_frozen_pr')
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
  }
  if (l1.model === l2.model) fail('adversarial_independence_invalid', 'l2_model_must_differ_from_l1')
  if (l3.packetSha256 !== decision.packetSha256) {
    fail('adversarial_raw_binding_invalid', 'l3_did_not_reread_bound_packet')
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

export function buildExactHeadMergeRequest(snapshot, lease, { now = new Date(), method = 'squash' } = {}) {
  if (!isPlainObject(snapshot) || !isPlainObject(lease)) fail('premerge_evidence_invalid', 'snapshot_or_lease_missing')
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
  const expiresAt = Date.parse(lease.expiresAt)
  if (!Number.isFinite(expiresAt) || !(now instanceof Date) || expiresAt <= now.getTime()) {
    fail('merge_authority_unavailable', 'lease_expired')
  }
  if (!['merge', 'squash', 'rebase'].includes(method)) fail('premerge_evidence_invalid', 'merge_method_not_allowed')
  return deepFreeze({ method, sha: snapshot.headOid })
}

class SingleFlightLedger {
  constructor(repository, active = null, history = []) {
    this.repository = repository
    this.active = active
    this.history = history
    Object.freeze(this.history)
    Object.freeze(this)
  }

  acquire({ deliveryId, prClass } = {}) {
    assertIdentifier(deliveryId, 'delivery_lock_invalid', 'delivery_id_invalid')
    if (!['ordinary', 'repair', 'revert', 'reconciliation', 'activation_canary', 'activation_closure'].includes(prClass)) {
      fail('delivery_lock_invalid', 'pr_class_invalid')
    }
    if (this.active !== null) fail('delivery_lock_held', 'repository_delivery_is_single_flight')
    const lease = deepFreeze({ repository: this.repository, deliveryId, prClass })
    return { ledger: new SingleFlightLedger(this.repository, lease, this.history), lease }
  }

  close({ deliveryId, terminalClass, reasonCode } = {}) {
    if (this.active === null || this.active.deliveryId !== deliveryId) {
      fail('delivery_lock_invalid', 'delivery_does_not_hold_lock')
    }
    const allowed = {
      DELIVERED: ['DELIVERY_VERIFIED'],
      FAILED: ['MERGED_NOT_DELIVERED'],
      HELD: [
        'PREMERGE_EVIDENCE_INVALID', 'PREMERGE_AUTHORITY_UNAVAILABLE',
        'POLICY_OR_SETTINGS_DRIFT', 'MERGE_OUTCOME_UNVERIFIED', 'DEPLOYMENT_BLOCKED',
        'DELIVERY_PENDING_FIXPOINT', 'ACTIVATION_UNATTESTED',
      ],
    }
    if (!allowed[terminalClass]?.includes(reasonCode)) fail('delivery_lock_invalid', 'terminal_mapping_invalid')
    const event = deepFreeze({ ...this.active, terminalClass, reasonCode })
    if (terminalClass !== 'DELIVERED') {
      return new SingleFlightLedger(this.repository, event, [...this.history, event])
    }
    return new SingleFlightLedger(this.repository, null, [...this.history, event])
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
const FINDING_SOURCES = new Set(['ci', 'reviewer', 'deterministic'])
const FINDING_VERIFICATIONS = new Set(['confirmed', 'refuted', 'unverified'])
const FINDING_DISPOSITIONS = new Set(['FIX', 'REJECT', 'ACCEPT_RISK', 'DEFER'])
const FOLLOW_UP_ISSUE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/u
const EVIDENCE_LOCATION = /^[^\r\n:][^\r\n]*:[1-9][0-9]*$/u

const validateFindingEvidence = (finding, label) => {
  if (!Array.isArray(finding.evidence) || finding.evidence.length < 1 || finding.evidence.length > 8) {
    fail('finding_disposition_incomplete', `${label}_evidence_missing_or_unbounded`)
  }
  if (finding.evidence.some((reference) => (
    typeof reference !== 'string' || reference.length > 240 || !EVIDENCE_LOCATION.test(reference)
  ))) fail('finding_disposition_invalid', `${label}_evidence_not_reproducible`)
  try {
    assertNoSecretShape(finding.evidence)
  } catch {
    fail('finding_disposition_invalid', `${label}_evidence_contains_secret`)
  }
}

const validateFindingDisposition = (finding, label, repository) => {
  exactKeys(finding, [
    'id', 'threadId', 'source', 'severity', 'verification', 'inScope', 'disposition',
    'fixedOnHead', 'evidence', 'policyRule', 'followUpRef', 'threadResolved',
  ], 'finding_disposition_invalid', `${label}_shape_invalid`)
  assertIdentifier(finding.id, 'finding_disposition_invalid', `${label}_id_invalid`)
  assertIdentifier(finding.threadId, 'finding_disposition_invalid', `${label}_thread_id_invalid`)
  if (!FINDING_SOURCES.has(finding.source)) fail('finding_disposition_invalid', `${label}_source_invalid`)
  if (!BLOCKING_FINDING_SEVERITIES.has(finding.severity) && !NON_BLOCKING_FINDING_SEVERITIES.has(finding.severity)) {
    fail('finding_disposition_invalid', `${label}_severity_invalid`)
  }
  if (!FINDING_VERIFICATIONS.has(finding.verification)) {
    fail('finding_disposition_invalid', `${label}_verification_invalid`)
  }
  if (!FINDING_DISPOSITIONS.has(finding.disposition)) {
    fail('finding_disposition_invalid', `${label}_disposition_invalid`)
  }
  if (typeof finding.inScope !== 'boolean' || typeof finding.fixedOnHead !== 'boolean' || typeof finding.threadResolved !== 'boolean') {
    fail('finding_disposition_invalid', `${label}_boolean_invalid`)
  }
  assertIdentifier(finding.policyRule, 'finding_disposition_invalid', `${label}_policy_rule_invalid`)
  validateFindingEvidence(finding, label)

  if (finding.verification === 'unverified') {
    fail('finding_disposition_incomplete', `${label}_verification_incomplete`)
  }
  if (finding.disposition === 'FIX' && (
    finding.verification !== 'confirmed' || !finding.inScope || !finding.fixedOnHead || finding.followUpRef !== null
  )) fail('finding_disposition_invalid', `${label}_fix_contract_invalid`)
  if (finding.disposition === 'REJECT' && (
    finding.verification !== 'refuted' || finding.fixedOnHead || finding.followUpRef !== null
  )) fail('finding_disposition_invalid', `${label}_reject_contract_invalid`)
  if (finding.disposition === 'ACCEPT_RISK' && (
    finding.verification !== 'confirmed' || finding.fixedOnHead || finding.followUpRef !== null ||
    BLOCKING_FINDING_SEVERITIES.has(finding.severity)
  )) fail('finding_disposition_invalid', `${label}_accepted_risk_not_policy_eligible`)
  if (finding.disposition === 'DEFER' && (
    finding.verification !== 'confirmed' || finding.inScope || finding.fixedOnHead ||
    typeof finding.followUpRef !== 'string' || !FOLLOW_UP_ISSUE.test(finding.followUpRef) ||
    !finding.followUpRef.startsWith(`https://github.com/${repository}/issues/`)
  )) fail('finding_disposition_invalid', `${label}_defer_contract_invalid`)
  if (finding.verification === 'confirmed' && finding.inScope && BLOCKING_FINDING_SEVERITIES.has(finding.severity) && finding.disposition !== 'FIX') {
    fail('finding_disposition_invalid', `${label}_blocking_finding_requires_fix`)
  }
  if (!finding.threadResolved) fail('finding_disposition_incomplete', `${label}_thread_not_resolved_after_disposition`)
  return clone(finding)
}

export function validateFindingDispositionBundle(bundle, expectedRequiredCheckSource) {
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
  const findings = bundle.findings.map((finding, index) => validateFindingDisposition(finding, `finding_${index}`, bundle.repository))
  if (new Set(findings.map((finding) => finding.id)).size !== findings.length ||
      new Set(findings.map((finding) => finding.threadId)).size !== findings.length) {
    fail('finding_disposition_invalid', 'finding_or_thread_identity_duplicated')
  }
  if (!bundle.threadsComplete || bundle.unresolvedThreads !== 0) {
    fail('finding_disposition_incomplete', 'server_conversation_collection_not_converged')
  }

  if (bundle.machineGate === null) {
    return deepFreeze({ ...clone(bundle), findings, reviewConverged: true, status: 'held' })
  }
  exactKeys(bundle.machineGate, [
    'name', 'appId', 'conclusion', 'headOid', 'observedAfterConvergence',
  ], 'finding_gate_order_invalid', 'machine_gate_shape_invalid')
  if (bundle.machineGate.observedAfterConvergence !== true) {
    fail('finding_gate_order_invalid', 'machine_gate_must_follow_exact_head_convergence')
  }
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

export function validateSubagentMergePlan(plan, { observedPrs, verifyProvenance } = {}) {
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

  const seen = new Set()
  const mergeOrder = plan.mergeOrder.map((entry, index) => {
    exactKeys(entry, [
      'prNumber', 'headOid', 'predecessorPrNumbers', 'dependencyProofSha256',
    ], 'merge_plan_invalid', `merge_order_${index}_shape_invalid`)
    if (!Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1 || seen.has(entry.prNumber)) {
      fail('merge_plan_invalid', `merge_order_${index}_pr_invalid`)
    }
    assertSha1(entry.headOid, 'merge_plan_invalid', `merge_order_${index}_head_invalid`)
    assertSha256(entry.dependencyProofSha256, 'merge_plan_invalid', `merge_order_${index}_proof_invalid`)
    if (!Array.isArray(entry.predecessorPrNumbers) || entry.predecessorPrNumbers.length > 32 ||
        new Set(entry.predecessorPrNumbers).size !== entry.predecessorPrNumbers.length ||
        entry.predecessorPrNumbers.some((prNumber) => !Number.isSafeInteger(prNumber) || !seen.has(prNumber))) {
      fail('merge_plan_dependency_invalid', `merge_order_${index}_predecessor_not_earlier`)
    }
    seen.add(entry.prNumber)
    return clone(entry)
  })

  if (!Array.isArray(plan.skips) || plan.skips.length > 100) {
    fail('merge_plan_skip_invalid', 'skip_registry_unbounded')
  }
  const skipped = new Set()
  const skips = plan.skips.map((entry, index) => {
    exactKeys(entry, [
      'prNumber', 'headOid', 'disposition', 'subsumedByPrNumber', 'proofSha256',
    ], 'merge_plan_skip_invalid', `skip_${index}_shape_invalid`)
    if (
      !Number.isSafeInteger(entry.prNumber) || entry.prNumber < 1 || seen.has(entry.prNumber) || skipped.has(entry.prNumber) ||
      entry.disposition !== 'SKIP_SUBSUMED' || !seen.has(entry.subsumedByPrNumber)
    ) fail('merge_plan_skip_invalid', `skip_${index}_lineage_invalid`)
    assertSha1(entry.headOid, 'merge_plan_skip_invalid', `skip_${index}_head_invalid`)
    assertSha256(entry.proofSha256, 'merge_plan_skip_invalid', `skip_${index}_proof_invalid`)
    skipped.add(entry.prNumber)
    return clone(entry)
  })
  if (!Array.isArray(observedPrs) || typeof verifyProvenance !== 'function') {
    fail('merge_plan_authority_invalid', 'authenticated_subagent_provenance_and_server_observations_required')
  }
  const plannedEntries = [...mergeOrder, ...skips]
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
