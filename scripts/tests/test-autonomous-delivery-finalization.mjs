import assert from 'node:assert/strict'
import test from 'node:test'

const loadSubject = () => import('../lib/autonomous-delivery-finalization.mjs')

const SHA = (value) => value.repeat(40)
const DIGEST = (value) => value.repeat(64)
const REPOSITORY = 'monkey1sai/AI-BIM-governance'
const EXPECTED_CHECK_SOURCE = Object.freeze({ name: 'autonomous-delivery-gate', appId: 4242 })
const CONVERGENCE_AT = '2026-09-01T08:00:00.000Z'

const makeGate = (headOid = SHA('a'), overrides = {}) => ({
  name: 'autonomous-delivery-gate',
  appId: 4242,
  conclusion: 'success',
  headOid,
  checkRunId: 200,
  startedAt: '2026-09-01T08:05:00.000Z',
  completedAt: '2026-09-01T08:09:00.000Z',
  ...overrides,
})

// Trusted-collector inputs: the complete same-head CheckRun list of the expected
// source and the convergence epoch never live inside the candidate bundle.
const makeRuns = (headOid = SHA('a'), runs = null) => (runs ?? [
  { id: 100, conclusion: 'failure', startedAt: '2026-09-01T07:50:00.000Z', completedAt: '2026-09-01T07:55:00.000Z' },
  { id: 200, conclusion: 'success', startedAt: '2026-09-01T08:05:00.000Z', completedAt: '2026-09-01T08:09:00.000Z' },
]).map((run) => ({ name: 'autonomous-delivery-gate', appId: 4242, headOid, ...run }))

const makeFinding = (overrides = {}) => ({
  id: 'ci-1',
  threadId: 'thread-1',
  source: 'ci',
  severity: 'P2',
  verification: 'confirmed',
  inScope: true,
  riskClass: 'correctness',
  disposition: 'FIX_REQUIRED',
  fixedOnHead: true,
  fixEvidence: {
    repairHeadOid: SHA('a'),
    regressionEvidence: ['scripts/tests/regression.mjs:10'],
    reReviewRef: 'codex-review-4bc7248-r2',
  },
  evidence: ['scripts/lib/module.mjs:12'],
  policyRule: 'confirmed-p2-in-scope',
  followUpRef: null,
  threadResolved: true,
  ...overrides,
})

const makeConvergedBundle = ({
  headOid = SHA('a'),
  repository = REPOSITORY,
  baseOid = SHA('b'),
  machineGate = {},
  findings = [],
} = {}) => ({
  schemaVersion: 'autonomous-delivery-finding-disposition/v1',
  repository,
  prNumber: 737,
  baseOid,
  headOid,
  policySha256: DIGEST('b'),
  threadsComplete: true,
  unresolvedThreads: 0,
  machineGate: machineGate === null ? null : makeGate(headOid, machineGate),
  findings,
})

// Trusted collector view of the conversation, derived from the bundle only in tests.
const collectedFrom = (bundle, overrides = {}) => ({
  complete: bundle.threadsComplete,
  unresolvedThreads: bundle.unresolvedThreads,
  findings: bundle.findings.map((finding) => ({
    id: finding.id, threadId: finding.threadId, source: finding.source, severity: finding.severity, resolved: finding.threadResolved,
    inScope: finding.inScope, riskClass: finding.riskClass,
  })),
  // Server-observed independent re-reviews, derived from the bundle only in tests.
  reReviews: [...new Map(bundle.findings.filter((finding) => finding.fixEvidence).map((finding) => [finding.fixEvidence.reReviewRef, {
    ref: finding.fixEvidence.reReviewRef, headOid: finding.fixEvidence.repairHeadOid, independent: true,
    regressionLocations: finding.fixEvidence.regressionEvidence,
  }])).values()],
  ...overrides,
})
const validateBundle = (validate, bundle, source = EXPECTED_CHECK_SOURCE, collectedConversation = collectedFrom(bundle), epoch = {}) => (
  validate(bundle, source, {
    collectedConversation, convergenceObservedAt: CONVERGENCE_AT, sameHeadCheckRuns: makeRuns(bundle.headOid),
    expectedPolicySha256: DIGEST('b'), ...epoch,
  })
)
const convergedOptions = (findings = [], conversation = {}) => ({
  expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE,
  collectedConversation: { complete: true, unresolvedThreads: 0, findings, reReviews: [], ...conversation },
  convergenceObservedAt: CONVERGENCE_AT, sameHeadCheckRuns: makeRuns(SHA('a')), expectedPolicySha256: DIGEST('b'),
})
// Ledger acquisition always carries an external exact-head classification result,
// and a delivered terminal is only recorded past the merge boundary with a verifier.
const CLASSIFIED = { verifyClassification: () => true }
const acquire = (ledger, input) => ledger.acquire(input, CLASSIFIED)
const TERMINAL_VERIFIED = { verifyTerminal: ({ evidenceRef, reasonCode }) => reasonCode === 'DELIVERY_VERIFIED' && evidenceRef.startsWith('delivery-evidence:') }
const deliver = (ledger, deliveryId) => ledger.markMergeBoundary({ deliveryId }).close({
  deliveryId, terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED', evidenceRef: `delivery-evidence:${deliveryId}`,
}, TERMINAL_VERIFIED)
const failMerged = (ledger, deliveryId) => ledger.markMergeBoundary({ deliveryId }).close({
  deliveryId, terminalClass: 'FAILED', reasonCode: 'MERGED_NOT_DELIVERED',
})

const expectCode = async (code, callback) => {
  await assert.rejects(callback, (error) => error?.code === code)
}

const throwsCode = (code, callback, detail) => {
  assert.throws(callback, (error) => error?.code === code && (detail === undefined || error?.detail === detail))
}

test('legacy human critical mode is rejected instead of becoming an approval fallback', async () => {
  const { normalizeReviewMode } = await loadSubject()
  assert.equal(normalizeReviewMode('critical_machine_adjudication'), 'critical_machine_adjudication')
  assert.throws(
    () => normalizeReviewMode('human_critical'),
    (error) => error?.code === 'legacy_review_mode_rejected',
  )
})

test('collector requires complete bounded pagination and detects cursor loops', async () => {
  const { collectPaginatedConnection } = await loadSubject()
  const pages = new Map([
    [null, { nodes: [{ id: 1 }], pageInfo: { hasNextPage: true, endCursor: 'p2' } }],
    ['p2', { nodes: [{ id: 2 }], pageInfo: { hasNextPage: false, endCursor: null } }],
  ])
  assert.deepEqual(await collectPaginatedConnection((cursor) => pages.get(cursor), {
    connection: 'reviewThreads', maxPages: 3, maxNodes: 10,
  }), [{ id: 1 }, { id: 2 }])

  await expectCode('pagination_incomplete', () => collectPaginatedConnection(async () => ({
    nodes: [], pageInfo: { hasNextPage: true, endCursor: null },
  }), { connection: 'reviews', maxPages: 3, maxNodes: 10 }))
  await expectCode('pagination_cursor_loop', () => collectPaginatedConnection(async () => ({
    nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' },
  }), { connection: 'checks', maxPages: 3, maxNodes: 10 }))
})

test('review surface classification is lossless, bounded, and fail closed for binary or secrets', async () => {
  const { classifyReviewSurface } = await loadSubject()
  const result = classifyReviewSurface({
    changedFiles: [
      { path: 'docs/agents/github-workflow.md', status: 'modified', binary: false, submodule: false },
      { path: 'scripts/lib/autonomous-delivery-finalization.mjs', status: 'added', binary: false, submodule: false },
    ],
    diff: [
      'diff --git a/docs/agents/github-workflow.md b/docs/agents/github-workflow.md',
      '+source-pinned contract',
      'diff --git a/scripts/lib/autonomous-delivery-finalization.mjs b/scripts/lib/autonomous-delivery-finalization.mjs',
      '+export const x = 1',
    ].join('\n'),
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  })
  assert.equal(result.reviewMode, 'critical_machine_adjudication')
  assert.equal(result.lossless, true)

  assert.throws(() => classifyReviewSurface({
    changedFiles: [{ path: 'asset.bin', status: 'added', binary: true, submodule: false }],
    diff: 'Binary files differ', limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), (error) => error?.code === 'unsupported_review_surface')
  assert.throws(() => classifyReviewSurface({
    changedFiles: [{ path: 'docs/a.md', status: 'modified', binary: false, submodule: false }],
    diff: 'github_pat_abcdefghijklmnop', limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), (error) => error?.code === 'secret_review_surface_blocked')
  assert.throws(() => classifyReviewSurface({
    changedFiles: [null], diff: 'diff', limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), (error) => error?.code === 'unsupported_review_surface')
  assert.throws(() => classifyReviewSurface({
    changedFiles: [{ path: '.env.production', status: 'modified', binary: false, submodule: false }],
    diff: '+DATABASE_URL=postgres://user:pass@host/db',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), (error) => error?.code === 'secret_review_surface_blocked')
  assert.throws(() => classifyReviewSurface({
    changedFiles: [{
      path: 'docs/config.txt', previousPath: '.env.production', status: 'renamed',
      binary: false, submodule: false,
    }],
    diff: 'similarity index 100%\nrename from .env.production\nrename to docs/config.txt',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), (error) => error?.code === 'secret_review_surface_blocked')
  const renamedMechanism = classifyReviewSurface({
    changedFiles: [{
      path: 'docs/ci.txt', previousPath: '.github/workflows/ci.yml', status: 'renamed',
      binary: false, submodule: false,
    }],
    diff: 'similarity index 100%\nrename from .github/workflows/ci.yml\nrename to docs/ci.txt',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  })
  assert.equal(renamedMechanism.reviewMode, 'critical_machine_adjudication')
  // A lowercase environment-style assignment is a secret; ordinary code assigning a
  // variable that happens to be called `token` is not.
  throwsCode('secret_review_surface_blocked', () => classifyReviewSurface({
    changedFiles: [{ path: '.env.example', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/.env.example b/.env.example\n+api_key=supersecretvalue',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), 'semantic_redaction_would_change_review_bytes')
  throwsCode('secret_review_surface_blocked', () => classifyReviewSurface({
    changedFiles: [{ path: 'docs/setup.md', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/docs/setup.md b/docs/setup.md\n export db_password=hunter2secret',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), 'semantic_redaction_would_change_review_bytes')
  assert.equal(classifyReviewSurface({
    changedFiles: [{ path: 'scripts/lib/x.mjs', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/scripts/lib/x.mjs b/scripts/lib/x.mjs\n+const token = await fetchToken(session)\n+  password = readPassword() // prompt',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }).lossless, true)
  // Colon-delimited secret fields (YAML/JSON) are caught whether quoted or not; ordinary code is not.
  throwsCode('secret_review_surface_blocked', () => classifyReviewSurface({
    changedFiles: [{ path: 'config/app.yml', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/config/app.yml b/config/app.yml\n+api_key: supersecretvalue',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), 'semantic_redaction_would_change_review_bytes')
  throwsCode('secret_review_surface_blocked', () => classifyReviewSurface({
    changedFiles: [{ path: 'config/app.json', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/config/app.json b/config/app.json\n+  "db_password": "hunter2secret",',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }), 'semantic_redaction_would_change_review_bytes')
  assert.equal(classifyReviewSurface({
    changedFiles: [{ path: 'scripts/lib/y.mjs', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/scripts/lib/y.mjs b/scripts/lib/y.mjs\n+  token: await fetchToken(session),\n+  password: readPassword(prompt),',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }).lossless, true)
  // Authoritative external contracts live under tests/contracts/ and are mechanism surface.
  assert.equal(classifyReviewSurface({
    changedFiles: [{ path: 'tests/contracts/ifc_ready_payload.json', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/tests/contracts/ifc_ready_payload.json b/tests/contracts/ifc_ready_payload.json\n+{}',
    limits: { maxFiles: 50, maxDiffBytes: 4096 },
  }).reviewMode, 'critical_machine_adjudication')
})

test('review surface binds the diff bytes to the declared changed files', async () => {
  const { classifyReviewSurface, extractDiffSurfacePaths } = await loadSubject()
  const limits = { maxFiles: 50, maxDiffBytes: 4096 }
  // Declared docs-only, but the bytes touch a mechanism path: must not route to the lowest lane.
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [{ path: 'docs/notes.md', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/scripts/lib/x.mjs b/scripts/lib/x.mjs\n+mechanism',
    limits,
  }), 'diff_path_not_declared_in_changed_files')
  // Declared file absent from the bytes: the packet is not lossless.
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [
      { path: 'docs/notes.md', status: 'modified', binary: false, submodule: false },
      { path: 'docs/other.md', status: 'modified', binary: false, submodule: false },
    ],
    diff: 'diff --git a/docs/notes.md b/docs/notes.md\n+text',
    limits,
  }), 'changed_file_missing_from_diff_bytes')
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [{ path: 'docs/notes.md', status: 'modified', binary: false, submodule: false }],
    diff: '+no headers at all',
    limits,
  }), 'diff_surface_paths_missing')
  // Unified file markers are part of the surface: a header that says docs while the
  // markers name a mechanism path is not lossless and not mechanical-only.
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [{ path: 'docs/notes.md', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/docs/notes.md b/docs/notes.md\n--- a/docs/notes.md\n+++ b/scripts/lib/x.mjs\n+text',
    limits,
  }), 'diff_path_not_declared_in_changed_files')
  assert.equal(classifyReviewSurface({
    changedFiles: [{ path: 'docs/notes.md', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/docs/notes.md b/docs/notes.md\n--- a/docs/notes.md\n+++ b/docs/notes.md\n@@ -1 +1 @@\n-old\n+new\n--- not a marker, a removed line',
    limits,
  }).reviewMode, 'mechanical_only')
  assert.equal(classifyReviewSurface({
    changedFiles: [{ path: 'docs/added.md', status: 'added', binary: false, submodule: false }],
    diff: 'diff --git a/docs/added.md b/docs/added.md\n--- /dev/null\n+++ b/docs/added.md\n+new file',
    limits,
  }).reviewMode, 'mechanical_only')
  assert.deepEqual([...extractDiffSurfacePaths('diff --git a/docs/a.md b/docs/a.md\n--- "a/docs/a.md"\n+++ "b/docs/a.md"')], ['docs/a.md'])
  // The collector flag is not the only witness: the bytes themselves reveal a binary change.
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [{ path: 'assets/logo.png', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files a/assets/logo.png and b/assets/logo.png differ',
    limits,
  }), 'binary_diff_marker_present')
  throwsCode('unsupported_review_surface', () => classifyReviewSurface({
    changedFiles: [{ path: 'vendor/lib', status: 'modified', binary: false, submodule: false }],
    diff: 'diff --git a/vendor/lib b/vendor/lib\n-Subproject commit ' + SHA('1') + '\n+Subproject commit ' + SHA('2'),
    limits,
  }), 'submodule_diff_marker_present')
  // Quoted non-ASCII header path round-trips through git's octal UTF-8 escaping.
  const quoted = classifyReviewSurface({
    changedFiles: [{ path: 'docs/新檔.md', status: 'added', binary: false, submodule: false }],
    diff: 'diff --git "a/docs/\\346\\226\\260\\346\\252\\224.md" "b/docs/\\346\\226\\260\\346\\252\\224.md"\n+內容',
    limits,
  })
  assert.equal(quoted.reviewMode, 'mechanical_only')
  // A copy names its source in the headers, so `copied` carries previousPath like a rename.
  const copied = classifyReviewSurface({
    changedFiles: [{ path: 'docs/b.md', previousPath: 'docs/a.md', status: 'copied', binary: false, submodule: false }],
    diff: ['diff --git a/docs/a.md b/docs/b.md', 'similarity index 100%', 'copy from docs/a.md', 'copy to docs/b.md'].join('\n'),
    limits,
  })
  assert.equal(copied.reviewMode, 'mechanical_only')
  assert.deepEqual([...extractDiffSurfacePaths('diff --git a/docs/a b.md b/docs/a b.md\n+x')], ['docs/a b.md'])
  throwsCode('unsupported_review_surface', () => extractDiffSurfacePaths('diff --git a/x c/y'), 'diff_header_path_unparseable')
  throwsCode('unsupported_review_surface', () => extractDiffSurfacePaths('diff --git a/../x b/../x'), 'diff_surface_path_not_canonical')
})

test('draft observations do not spend budget and round two blockers close HELD without a third head', async () => {
  const { applyFinalizationEvent, createFinalizationState } = await loadSubject()
  let state = createFinalizationState({ repository: REPOSITORY, prNumber: 737, baseOid: SHA('b') })
  state = applyFinalizationEvent(state, { type: 'draft_observed', headOid: SHA('a') })
  assert.equal(state.rounds.length, 0)
  state = applyFinalizationEvent(state, { type: 'ready', headOid: SHA('a') })
  state = applyFinalizationEvent(state, {
    type: 'round_blocked', headOid: SHA('a'), evidenceSha256: DIGEST('1'),
    blockers: ['confirmed:blocker-1'],
  })
  assert.equal(state.phase, 'BATCH_REPAIR_PENDING')
  state = applyFinalizationEvent(state, { type: 'batch_repair', headOid: SHA('c') })
  state = applyFinalizationEvent(state, {
    type: 'round_blocked', headOid: SHA('c'), evidenceSha256: DIGEST('2'),
    blockers: ['confirmed:blocker-2'],
  })
  assert.equal(state.phase, 'CLOSED')
  assert.equal(state.terminalClass, 'HELD')
  assert.equal(state.reasonCode, 'PREMERGE_EVIDENCE_INVALID')
  assert.equal(state.failureDetail, 'review_round_budget_exhausted')
  assert.throws(
    () => applyFinalizationEvent(state, { type: 'batch_repair', headOid: SHA('d') }),
    (error) => error?.code === 'finalization_closed',
  )
  assert.throws(
    () => applyFinalizationEvent(undefined, { type: 'ready', headOid: SHA('a') }),
    (error) => error?.code === 'finalization_state_invalid',
  )
  assert.throws(
    () => applyFinalizationEvent(createFinalizationState({ repository: REPOSITORY, prNumber: 737, baseOid: SHA('b') }), {
      type: 'ready', headOid: SHA('a'), unexpected: true,
    }),
    (error) => error?.code === 'finalization_event_invalid',
  )
})

test('READY_TO_MERGE requires composed finding convergence and the source-pinned exact-head gate', async () => {
  const { applyFinalizationEvent, createFinalizationState } = await loadSubject()
  let state = createFinalizationState({ repository: REPOSITORY, prNumber: 737, baseOid: SHA('b') })
  state = applyFinalizationEvent(state, { type: 'ready', headOid: SHA('a') })
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_completed', headOid: SHA('a'), evidenceComplete: true,
    blockers: [], requiredGatePassed: true,
  }), (error) => error?.code === 'finalization_event_invalid')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'),
    findingBundle: makeConvergedBundle({ machineGate: { appId: 9999 } }),
  }, convergedOptions()), (error) => error?.code === 'required_check_not_authoritative')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }, { expectedPolicySha256: DIGEST('b') }), (error) => error?.code === 'finding_gate_order_invalid')
  assert.throws(() => applyFinalizationEvent({ ...state, rounds: [] }, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }, convergedOptions()), (error) => error?.code === 'finalization_state_invalid')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'),
    findingBundle: makeConvergedBundle({ repository: 'attacker/other-repo' }),
  }, convergedOptions()), (error) => error?.code === 'finalization_event_invalid')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'),
    findingBundle: makeConvergedBundle({ baseOid: SHA('d') }),
  }, convergedOptions()), (error) => error?.code === 'finalization_event_invalid')
  state = applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }, convergedOptions())
  assert.equal(state.phase, 'READY_TO_MERGE')
})

test('an escalated finding closes the transaction HELD outside autonomous authority', async () => {
  const { applyFinalizationEvent, createFinalizationState } = await loadSubject()
  let state = createFinalizationState({ repository: REPOSITORY, prNumber: 737, baseOid: SHA('b') })
  state = applyFinalizationEvent(state, { type: 'ready', headOid: SHA('a') })
  state = applyFinalizationEvent(state, {
    type: 'round_converged',
    headOid: SHA('a'),
    findingBundle: {
      ...makeConvergedBundle({
        findings: [makeFinding({
          riskClass: 'credentials', disposition: 'ESCALATE', fixedOnHead: false, fixEvidence: null,
          threadResolved: false, policyRule: 'high-risk-escalation',
        })],
      }),
      unresolvedThreads: 1,
    },
  }, convergedOptions([{ id: 'ci-1', threadId: 'thread-1', source: 'ci', severity: 'P2', resolved: false, inScope: true, riskClass: 'credentials' }], { unresolvedThreads: 1 }))
  assert.equal(state.phase, 'CLOSED')
  assert.equal(state.terminalClass, 'HELD')
  assert.equal(state.failureDetail, 'finding_escalated_to_external_authority')
})

test('source-pinned gate accepts only expected App actual success on the frozen head', async () => {
  const { validateSourcePinnedRequiredCheck } = await loadSubject()
  const expected = { name: 'autonomous-delivery-gate', appId: 4242, headOid: SHA('a') }
  assert.equal(validateSourcePinnedRequiredCheck({
    name: expected.name, appId: expected.appId, headOid: expected.headOid, conclusion: 'success',
  }, expected), true)
  for (const candidate of [
    { ...expected, conclusion: 'neutral' },
    { ...expected, conclusion: 'skipped' },
    { ...expected, appId: 9999, conclusion: 'success' },
    { ...expected, headOid: SHA('c'), conclusion: 'success' },
  ]) {
    assert.throws(
      () => validateSourcePinnedRequiredCheck(candidate, expected),
      (error) => error?.code === 'required_check_not_authoritative',
    )
  }
  assert.throws(
    () => validateSourcePinnedRequiredCheck(
      { appId: 4242, headOid: SHA('a'), conclusion: 'success' },
      { appId: 4242, headOid: SHA('a') },
    ),
    (error) => error?.code === 'required_check_not_authoritative',
  )
})

test('adversarial decision requires distinct models, per-layer packet binding, and G1-G12 pass', async () => {
  const { validateAdversarialDecision, canonicalSha256 } = await loadSubject()
  const rubric = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `G${index + 1}`, { status: 'pass', evidence: `scripts/tests/evidence-${index + 1}.json:1` },
  ]))
  const packetSha256 = DIGEST('a')
  const l1 = { model: 'finder-model', output: 'closed', packetSha256, findings: [] }
  const l2 = {
    model: 'refuter-model', output: 'closed', packetSha256, l1OutputSha256: canonicalSha256(l1),
    killed: [], surviving: [], unverified: [],
  }
  const l3 = {
    model: 'apex-model', output: 'closed', packetSha256,
    l1OutputSha256: canonicalSha256(l1), l2OutputSha256: canonicalSha256(l2),
    verdict: 'passed', unresolvedHighCritical: [], rubric,
  }
  const decision = { packetSha256, layers: { l1, l2, l3 } }
  assert.equal(validateAdversarialDecision(decision).verdict, 'passed')
  assert.throws(() => validateAdversarialDecision({
    ...decision,
    layers: { ...decision.layers, l2: { ...l2, model: 'finder-model' } },
  }), (error) => error?.code === 'adversarial_independence_invalid')
  assert.throws(() => validateAdversarialDecision({
    ...decision,
    layers: {
      ...decision.layers,
      l3: { ...l3, rubric: { ...rubric, G7: { status: 'uncertain', evidence: 'none:1' } } },
    },
  }), (error) => error?.code === 'activation_unattested')
  // L1 produced against an older head while L3 binds the current packet.
  throwsCode('adversarial_raw_binding_invalid', () => validateAdversarialDecision({
    ...decision, layers: { ...decision.layers, l1: { ...l1, packetSha256: DIGEST('0') } },
  }), 'l1_did_not_reread_bound_packet')
  // L2 refuted a different L1 output than the one presented.
  throwsCode('adversarial_raw_binding_invalid', () => validateAdversarialDecision({
    ...decision, layers: { ...decision.layers, l2: { ...l2, l1OutputSha256: DIGEST('1') } },
  }), 'l2_not_bound_to_exact_l1_output')
  throwsCode('adversarial_raw_binding_invalid', () => validateAdversarialDecision({
    ...decision, layers: { ...decision.layers, l3: { ...l3, l2OutputSha256: DIGEST('2') } },
  }), 'l3_not_bound_to_exact_layer_outputs')
  // L3 cannot clear a HIGH/CRITICAL blocker that L2 reports as surviving: the L3
  // set must be reconciled with the bound L2 output, and any survivor fails the verdict.
  const survivingL2 = { ...l2, surviving: [{ id: 'finding-9', severity: 'HIGH' }, { id: 'finding-10', severity: 'LOW' }] }
  const boundL3 = { ...l3, l2OutputSha256: canonicalSha256(survivingL2) }
  throwsCode('adversarial_raw_binding_invalid', () => validateAdversarialDecision({
    ...decision, layers: { l1, l2: survivingL2, l3: boundL3 },
  }), 'l3_blocker_set_not_reconciled_with_l2')
  throwsCode('adversarial_blocker_unresolved', () => validateAdversarialDecision({
    ...decision, layers: { l1, l2: survivingL2, l3: { ...boundL3, unresolvedHighCritical: ['finding-9'] } },
  }), 'high_or_critical_blocker_survived')
  const lowOnlyL2 = { ...l2, surviving: [{ id: 'finding-10', severity: 'LOW' }] }
  assert.equal(validateAdversarialDecision({
    ...decision, layers: { l1, l2: lowOnlyL2, l3: { ...l3, l2OutputSha256: canonicalSha256(lowOnlyL2) } },
  }).verdict, 'passed')
  throwsCode('adversarial_output_invalid', () => validateAdversarialDecision({
    ...decision, layers: { l1, l2: { ...l2, surviving: 'none' }, l3: { ...l3, l2OutputSha256: canonicalSha256({ ...l2, surviving: 'none' }) } },
  }), 'l2_survivor_set_invalid')
})

test('merge preparation is exact-head CAS and refuses partial threads, stale state, or a broken clock', async () => {
  const { buildExactHeadMergeRequest } = await loadSubject()
  const snapshot = {
    repository: 'monkey1sai/AI-BIM-governance', prNumber: 737,
    baseOid: SHA('b'), headOid: SHA('a'), state: 'OPEN', draft: false,
    mergeable: true, threadsComplete: true, unresolvedThreads: 0,
    settingsEpochSha256: DIGEST('e'), evidenceSha256: DIGEST('f'),
  }
  const lease = {
    repository: snapshot.repository, prNumber: snapshot.prNumber,
    baseOid: snapshot.baseOid, headOid: snapshot.headOid,
    settingsEpochSha256: snapshot.settingsEpochSha256,
    evidenceSha256: snapshot.evidenceSha256, nonce: 'n'.repeat(32),
    expiresAt: '2026-09-01T08:10:00.000Z', consumed: false, method: 'squash',
  }
  const consumed = []
  const consumeLease = (bound) => {
    if (consumed.includes(bound.nonce)) return false
    consumed.push(bound.nonce)
    // The authority authenticates the method it authorized as part of the consumption payload.
    return bound.headOid === SHA('a') && bound.method === 'squash' && /^[0-9a-f]{64}$/.test(bound.leaseSha256)
  }
  // A lease issued for a squash cannot be spent on a rebase or a merge commit.
  throwsCode('policy_or_settings_drift', () => buildExactHeadMergeRequest(snapshot, lease, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'rebase', consumeLease: () => true,
  }), 'lease_method_mismatch')
  throwsCode('policy_or_settings_drift', () => buildExactHeadMergeRequest(snapshot, { ...lease, method: 'merge' }, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease: () => true,
  }), 'lease_method_mismatch')
  assert.deepEqual(buildExactHeadMergeRequest(snapshot, lease, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease,
  }), { method: 'squash', sha: SHA('a') })
  // The same lease cannot authorize a second merge request: the authority already consumed its nonce.
  throwsCode('merge_authority_unavailable', () => buildExactHeadMergeRequest(snapshot, lease, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease,
  }), 'lease_not_authenticated_or_already_consumed')
  // A fabricated lease that merely copies the snapshot cannot pass without the external authority.
  throwsCode('merge_authority_unavailable', () => buildExactHeadMergeRequest(snapshot, lease, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash',
  }), 'external_lease_authority_required')
  throwsCode('merge_authority_unavailable', () => buildExactHeadMergeRequest(snapshot, { ...lease, nonce: 'x'.repeat(32) }, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease: () => { throw new Error('broker offline') },
  }), 'lease_not_authenticated_or_already_consumed')
  assert.throws(() => buildExactHeadMergeRequest(
    { ...snapshot, threadsComplete: false }, lease,
    { now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease: () => true },
  ), (error) => error?.code === 'premerge_evidence_invalid')
  // An invalid Date would compare false against any expiry and silently accept an expired lease.
  throwsCode('merge_authority_unavailable', () => buildExactHeadMergeRequest(
    snapshot, { ...lease, expiresAt: '2020-01-01T00:00:00.000Z' },
    { now: new Date('not-a-date'), method: 'squash', consumeLease: () => true },
  ), 'clock_invalid')
  throwsCode('merge_authority_unavailable', () => buildExactHeadMergeRequest(
    snapshot, { ...lease, expiresAt: '2020-01-01T00:00:00.000Z' },
    { now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash', consumeLease: () => true },
  ), 'lease_expired')
})

test('single-flight lock keeps ordinary PRs queued until terminal delivery and admits release hotfixes', async () => {
  const { createSingleFlightLedger } = await loadSubject()
  let ledger = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger } = acquire(ledger, { deliveryId: 'delivery-737', prClass: 'ordinary' }))
  assert.throws(
    () => acquire(ledger, { deliveryId: 'delivery-738', prClass: 'ordinary' }),
    (error) => error?.code === 'delivery_lock_held',
  )
  ledger = deliver(ledger, 'delivery-737')
  assert.equal(acquire(ledger, { deliveryId: 'delivery-738', prClass: 'ordinary' }).lease.deliveryId, 'delivery-738')
  assert.equal(acquire(ledger, { deliveryId: 'hotfix-1', prClass: 'release_hotfix' }).lease.prClass, 'release_hotfix')
  throwsCode('delivery_lock_invalid', () => acquire(ledger, { deliveryId: 'draft-1', prClass: 'draft_report_only' }), 'pr_class_invalid')
  // A merged terminal is only recordable past the merge boundary, and DELIVERED needs verified terminal evidence.
  let unmerged = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: unmerged } = acquire(unmerged, { deliveryId: 'delivery-50', prClass: 'ordinary' }))
  throwsCode('delivery_lock_invalid', () => unmerged.close({ deliveryId: 'delivery-50', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED', evidenceRef: 'delivery-evidence:delivery-50' }, TERMINAL_VERIFIED), 'terminal_requires_merge_boundary')
  throwsCode('delivery_lock_invalid', () => unmerged.close({ deliveryId: 'delivery-50', terminalClass: 'FAILED', reasonCode: 'MERGED_NOT_DELIVERED' }), 'terminal_requires_merge_boundary')
  const merged = unmerged.markMergeBoundary({ deliveryId: 'delivery-50' })
  throwsCode('delivery_lock_invalid', () => merged.close({ deliveryId: 'delivery-50', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED' }, TERMINAL_VERIFIED), 'terminal_delivery_unverified')
  throwsCode('delivery_lock_invalid', () => merged.close({ deliveryId: 'delivery-50', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED', evidenceRef: 'delivery-evidence:delivery-50' }), 'terminal_delivery_unverified')
  throwsCode('delivery_lock_invalid', () => merged.close({ deliveryId: 'delivery-50', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED', evidenceRef: 'forged:delivery-50' }, TERMINAL_VERIFIED), 'terminal_delivery_unverified')
  throwsCode('delivery_lock_invalid', () => merged.close({ deliveryId: 'delivery-50', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED', evidenceRef: 'delivery-evidence:delivery-50' }, { verifyTerminal: () => { throw new Error('verifier offline') } }), 'terminal_delivery_unverified')
  assert.equal(deliver(merged, 'delivery-50').history.at(-1).evidenceRef, 'delivery-evidence:delivery-50')
  // A pre-merge hold still closes without a boundary.
  assert.equal(unmerged.close({ deliveryId: 'delivery-50', terminalClass: 'HELD', reasonCode: 'PREMERGE_EVIDENCE_INVALID' }).active, null)
  // The class is never the caller's word: an external exact-head classification must confirm it.
  throwsCode('delivery_lock_invalid', () => ledger.acquire({ deliveryId: 'delivery-740', prClass: 'ordinary' }), 'pr_classification_unverified')
  throwsCode('delivery_lock_invalid', () => ledger.acquire({ deliveryId: 'delivery-740', prClass: 'ordinary' }, {
    verifyClassification: ({ prClass }) => prClass === 'repair',
  }), 'pr_classification_unverified')
  throwsCode('delivery_lock_invalid', () => ledger.acquire({ deliveryId: 'delivery-740', prClass: 'ordinary' }, {
    verifyClassification: () => { throw new Error('classifier offline') },
  }), 'pr_classification_unverified')
  const bound = []
  assert.equal(ledger.acquire({ deliveryId: 'delivery-740', prClass: 'ordinary' }, {
    verifyClassification: (request) => { bound.push(request); return request.prClass === 'ordinary' && request.deliveryId === 'delivery-740' },
  }).lease.mergeBoundaryCrossed, false)
  assert.deepEqual(bound, [{ repository: 'monkey1sai/AI-BIM-governance', deliveryId: 'delivery-740', prClass: 'ordinary', supersedesDeliveryId: null }])
})

test('policy drift detected after the merge boundary keeps the lineage bound instead of releasing the queue', async () => {
  const { createSingleFlightLedger } = await loadSubject()
  // Before the merge boundary the same reason code merged nothing and frees the queue.
  let pre = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: pre } = acquire(pre, { deliveryId: 'delivery-30', prClass: 'ordinary' }))
  pre = pre.close({ deliveryId: 'delivery-30', terminalClass: 'HELD', reasonCode: 'POLICY_OR_SETTINGS_DRIFT' })
  assert.equal(pre.openRecovery, null)
  assert.equal(acquire(pre, { deliveryId: 'delivery-31', prClass: 'ordinary' }).lease.deliveryId, 'delivery-31')
  // After the merge request was issued, drift is a post-merge hold bound to reconciliation.
  let post = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: post } = acquire(post, { deliveryId: 'delivery-40', prClass: 'ordinary' }))
  throwsCode('delivery_lock_invalid', () => post.markMergeBoundary({ deliveryId: 'delivery-41' }), 'delivery_does_not_hold_lock')
  post = post.markMergeBoundary({ deliveryId: 'delivery-40' })
  assert.equal(post.active.mergeBoundaryCrossed, true)
  post = post.close({ deliveryId: 'delivery-40', terminalClass: 'HELD', reasonCode: 'POLICY_OR_SETTINGS_DRIFT' })
  assert.equal(post.active, null)
  assert.equal(post.openRecovery.deliveryId, 'delivery-40')
  assert.equal(post.history.at(-1).mergeBoundaryCrossed, true)
  throwsCode('delivery_lock_frozen', () => acquire(post, { deliveryId: 'delivery-42', prClass: 'ordinary' }))
  throwsCode('delivery_lock_frozen', () => acquire(post, { deliveryId: 'repair-40', prClass: 'repair', supersedesDeliveryId: 'delivery-40' }))
  throwsCode('delivery_lock_invalid', () => post.unfreeze({ deliveryId: 'delivery-40', authorityRef: 'owner-transaction-2', verifyAuthority: () => true }), 'unfreeze_not_allowed_for_recoverable_terminal')
  const reconciled = acquire(post, { deliveryId: 'reconcile-40', prClass: 'reconciliation', supersedesDeliveryId: 'delivery-40' })
  assert.equal(reconciled.lease.prClass, 'reconciliation')
  assert.equal(reconciled.lease.supersedesDeliveryId, 'delivery-40')
})

test('non-delivered closure releases the lock but freezes the queue to the bound recovery lane', async () => {
  const { createSingleFlightLedger } = await loadSubject()
  let ledger = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger } = acquire(ledger, { deliveryId: 'delivery-1', prClass: 'ordinary' }))
  ledger = failMerged(ledger, 'delivery-1')
  assert.equal(ledger.active, null)
  assert.equal(ledger.openRecovery.deliveryId, 'delivery-1')
  // Closing again cannot append a second contradictory terminal for the same delivery.
  throwsCode('delivery_lock_invalid', () => ledger.close({
    deliveryId: 'delivery-1', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED',
  }), 'delivery_does_not_hold_lock')
  throwsCode('delivery_lock_frozen', () => acquire(ledger, { deliveryId: 'delivery-2', prClass: 'ordinary' }))
  throwsCode('delivery_lock_frozen', () => acquire(ledger, {
    deliveryId: 'reconcile-1', prClass: 'reconciliation', supersedesDeliveryId: 'delivery-1',
  }))
  throwsCode('delivery_lock_invalid', () => acquire(ledger, { deliveryId: 'repair-1', prClass: 'repair' }), 'recovery_must_bind_exact_terminal_delivery_id')
  ;({ ledger } = acquire(ledger, { deliveryId: 'repair-1', prClass: 'repair', supersedesDeliveryId: 'delivery-1' }))
  assert.equal(ledger.active.supersedesDeliveryId, 'delivery-1')
  ledger = deliver(ledger, 'repair-1')
  assert.equal(ledger.openRecovery, null)
  assert.equal(acquire(ledger, { deliveryId: 'delivery-3', prClass: 'ordinary' }).lease.prClass, 'ordinary')
  // A repair lane without a terminal lineage to bind is not admissible.
  throwsCode('delivery_lock_invalid', () => acquire(ledger, { deliveryId: 'repair-2', prClass: 'repair' }), 'recovery_lane_requires_bound_terminal_lineage')
  // Pre-merge HELD merged nothing, so the queue is not frozen.
  let held = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: held } = acquire(held, { deliveryId: 'delivery-9', prClass: 'ordinary' }))
  held = held.close({ deliveryId: 'delivery-9', terminalClass: 'HELD', reasonCode: 'PREMERGE_EVIDENCE_INVALID' })
  assert.equal(held.openRecovery, null)
  assert.equal(acquire(held, { deliveryId: 'delivery-10', prClass: 'ordinary' }).lease.deliveryId, 'delivery-10')
  // Post-merge unprovable HELD opens only the bound reconciliation lane.
  let ambiguous = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: ambiguous } = acquire(ambiguous, { deliveryId: 'delivery-11', prClass: 'ordinary' }))
  ambiguous = ambiguous.close({ deliveryId: 'delivery-11', terminalClass: 'HELD', reasonCode: 'MERGE_OUTCOME_UNVERIFIED' })
  throwsCode('delivery_lock_frozen', () => acquire(ambiguous, { deliveryId: 'repair-3', prClass: 'repair', supersedesDeliveryId: 'delivery-11' }))
  assert.equal(acquire(ambiguous, {
    deliveryId: 'reconcile-2', prClass: 'reconciliation', supersedesDeliveryId: 'delivery-11',
  }).lease.prClass, 'reconciliation')
  // Other post-merge HELD opens no autonomous lane at all.
  let blocked = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: blocked } = acquire(blocked, { deliveryId: 'delivery-12', prClass: 'ordinary' }))
  blocked = blocked.close({ deliveryId: 'delivery-12', terminalClass: 'HELD', reasonCode: 'DEPLOYMENT_BLOCKED' })
  throwsCode('delivery_lock_frozen', () => acquire(blocked, { deliveryId: 'reconcile-3', prClass: 'reconciliation', supersedesDeliveryId: 'delivery-12' }))
  // A pre-merge HELD on the bound repair must not release the merged-not-delivered lineage.
  let lineage = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger: lineage } = acquire(lineage, { deliveryId: 'delivery-20', prClass: 'ordinary' }))
  lineage = failMerged(lineage, 'delivery-20')
  ;({ ledger: lineage } = acquire(lineage, { deliveryId: 'repair-20', prClass: 'repair', supersedesDeliveryId: 'delivery-20' }))
  lineage = lineage.close({ deliveryId: 'repair-20', terminalClass: 'HELD', reasonCode: 'PREMERGE_EVIDENCE_INVALID' })
  assert.equal(lineage.openRecovery.deliveryId, 'delivery-20')
  throwsCode('delivery_lock_frozen', () => acquire(lineage, { deliveryId: 'delivery-21', prClass: 'ordinary' }))
  assert.equal(acquire(lineage, { deliveryId: 'repair-21', prClass: 'repair', supersedesDeliveryId: 'delivery-20' }).lease.prClass, 'repair')
  // The only exit from a lane-less freeze is an audited, externally verified unfreeze naming the exact terminal.
  const verifyAuthority = ({ authorityRef, reasonCode }) => authorityRef === 'owner-transaction-1' && reasonCode === 'DEPLOYMENT_BLOCKED'
  throwsCode('delivery_lock_invalid', () => blocked.unfreeze({ deliveryId: 'delivery-99', authorityRef: 'owner-transaction-1', verifyAuthority }), 'unfreeze_must_name_open_terminal_delivery')
  throwsCode('delivery_lock_invalid', () => blocked.unfreeze({ deliveryId: 'delivery-12', authorityRef: '', verifyAuthority }), 'unfreeze_authority_ref_invalid')
  throwsCode('delivery_lock_invalid', () => blocked.unfreeze({ deliveryId: 'delivery-12', authorityRef: 'owner-transaction-1' }), 'unfreeze_authority_unverified')
  throwsCode('delivery_lock_invalid', () => blocked.unfreeze({ deliveryId: 'delivery-12', authorityRef: 'someone-else', verifyAuthority }), 'unfreeze_authority_unverified')
  // A merged-not-delivered or reconciliation-required terminal must go through its lane, never the hatch.
  throwsCode('delivery_lock_invalid', () => lineage.unfreeze({ deliveryId: 'delivery-20', authorityRef: 'owner-transaction-1', verifyAuthority: () => true }), 'unfreeze_not_allowed_for_recoverable_terminal')
  throwsCode('delivery_lock_invalid', () => ambiguous.unfreeze({ deliveryId: 'delivery-11', authorityRef: 'owner-transaction-1', verifyAuthority: () => true }), 'unfreeze_not_allowed_for_recoverable_terminal')
  const thawed = blocked.unfreeze({ deliveryId: 'delivery-12', authorityRef: 'owner-transaction-1', verifyAuthority })
  assert.equal(thawed.openRecovery, null)
  assert.equal(thawed.history.at(-1).unfrozenBy, 'owner-transaction-1')
  assert.equal(acquire(thawed, { deliveryId: 'delivery-13', prClass: 'ordinary' }).lease.deliveryId, 'delivery-13')
})

test('trust-root descriptor and activation plan are non-secret, closed, and sink-disabled before canary', async () => {
  const { validateActivationPlan, validateTrustRootDescriptor } = await loadSubject()
  assert.equal(validateTrustRootDescriptor({
    schemaVersion: 'autonomous-delivery-trust-root/v1', appId: 4242,
    issuerId: 'issuer-1', keyIds: ['key-2026-09'], rotation: 'add_before_remove',
    credentialTtlSeconds: 600, artifactAcl: 'issuer_and_executor', retention: 'audit_1y',
    egress: 'deny_by_default', quotas: { cpuSeconds: 60, wallSeconds: 120, memoryMb: 1024, outputBytes: 1048576 },
  }).appId, 4242)
  assert.throws(() => validateTrustRootDescriptor({
    schemaVersion: 'autonomous-delivery-trust-root/v1', appId: 4242,
    issuerId: 'issuer-1', keyIds: ['key-2026-09'], rotation: 'add_before_remove',
    credentialTtlSeconds: 600, artifactAcl: 'issuer_and_executor', retention: 'audit_1y',
    egress: 'deny_by_default', quotas: { cpuSeconds: 60, wallSeconds: 120, memoryMb: 1024, outputBytes: 1048576 },
    privateKey: 'forbidden',
  }), (error) => error?.code === 'trust_root_descriptor_invalid')
  assert.equal(validateActivationPlan({
    schemaVersion: 'autonomous-delivery-activation-plan/v1', phase: 'SHADOW_DUAL',
    sinkEnabled: false, commandId: 'shadow-negative-matrix', authorityId: 'external-broker',
    preStateSha256: DIGEST('a'), expectedObservationSha256: DIGEST('b'),
    artifactSchemaId: 'autonomous-delivery-shadow-evidence/v1',
    rollbackCommandId: 'disable-sink-and-restore-legacy',
  }).phase, 'SHADOW_DUAL')
})

test('CI and review findings converge through the five closed dispositions without equating resolution to a code fix', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const bundle = makeConvergedBundle({
    findings: [
      makeFinding(),
      makeFinding({
        id: 'review-2', threadId: 'thread-2', source: 'reviewer', severity: 'P3',
        disposition: 'ACCEPTED', fixedOnHead: false, fixEvidence: null,
        evidence: ['docs/agents/github-workflow.md:1'], policyRule: 'nonblocking-naming-advisory',
      }),
      makeFinding({
        id: 'review-3', threadId: 'thread-3', source: 'reviewer', severity: 'HIGH',
        verification: 'refuted', disposition: 'FALSE_POSITIVE', fixedOnHead: false, fixEvidence: null,
        evidence: ['scripts/tests/regression.mjs:20'], policyRule: 'false-positive-evidence',
      }),
      makeFinding({
        id: 'ci-4', threadId: 'thread-4', source: 'deterministic', severity: 'MEDIUM',
        inScope: false, disposition: 'DEFERRED', fixedOnHead: false, fixEvidence: null,
        evidence: ['docs/agents/github-workflow.md:2'], policyRule: 'outside-pr-scope',
        followUpRef: 'https://github.com/monkey1sai/AI-BIM-governance/issues/900',
      }),
      // A stale P2 that a prior commit on this head already addressed.
      makeFinding({
        id: 'human-5', threadId: 'thread-5', source: 'human', severity: 'P2',
        disposition: 'ACCEPTED', fixedOnHead: true,
        fixEvidence: { repairHeadOid: SHA('a'), regressionEvidence: ['scripts/tests/regression.mjs:40'], reReviewRef: 'codex-review-4bc7248-r1' },
        evidence: ['scripts/lib/module.mjs:40'], policyRule: 'already-addressed-on-head',
      }),
      // Legacy vocabulary is normalized rather than rejected.
      makeFinding({ id: 'legacy-6', threadId: 'thread-6', disposition: 'FIX' }),
    ],
  })
  const result = validateBundle(validateFindingDispositionBundle, bundle)
  assert.equal(result.status, 'passed')
  assert.equal(result.reviewConverged, true)
  assert.equal(result.findings.filter((finding) => finding.fixedOnHead).length, 3)
  assert.equal(result.findings.at(-1).disposition, 'FIX_REQUIRED')
  // The bundle must cover the complete collector finding set: omitting a collected
  // blocking finding, or presenting one the collector never saw, cannot converge.
  const collected = collectedFrom(bundle)
  throwsCode('finding_disposition_incomplete', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: [...collected.findings, { id: 'ci-omitted', threadId: 'thread-omitted', source: 'ci', severity: 'P1', resolved: true, inScope: true, riskClass: 'correctness' }] },
  ), 'dispositions_do_not_cover_complete_collected_finding_set')
  throwsCode('finding_disposition_incomplete', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE, { ...collected, findings: collected.findings.slice(1) },
  ), 'dispositions_do_not_cover_complete_collected_finding_set')
  throwsCode('finding_disposition_incomplete', () => validateFindingDispositionBundle(bundle, EXPECTED_CHECK_SOURCE), 'collector_conversation_state_required')
  // Weakening a collected record (severity, source or thread) is not a disposition.
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: collected.findings.map((entry) => (entry.id === 'review-2' ? { ...entry, severity: 'P1' } : entry)) },
  ), 'finding_1_not_bound_to_collected_record')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: collected.findings.map((entry) => (entry.id === 'ci-1' ? { ...entry, threadId: 'thread-9' } : entry)) },
  ), 'finding_0_not_bound_to_collected_record')
  // GitHub still reports the thread open: the bundle's threadResolved claim has no authority.
  throwsCode('finding_disposition_incomplete', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, unresolvedThreads: 1, findings: collected.findings.map((entry) => (entry.id === 'ci-1' ? { ...entry, resolved: false } : entry)) },
  ), 'finding_0_thread_resolution_not_server_observed')
  throwsCode('finding_disposition_incomplete', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE, { ...collected, complete: false },
  ), 'conversation_state_not_server_observed')
  // Scope and risk class are collector classifications: the bundle cannot move a
  // finding out of scope or downgrade a high-risk class to a weaker autonomous rule.
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: collected.findings.map((entry) => (entry.id === 'ci-1' ? { ...entry, inScope: false } : entry)) },
  ), 'finding_0_not_bound_to_collected_record')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: collected.findings.map((entry) => (entry.id === 'ci-1' ? { ...entry, riskClass: 'security' } : entry)) },
  ), 'finding_0_not_bound_to_collected_record')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, findings: collected.findings.map((entry) => (entry.id === 'ci-1' ? { ...entry, riskClass: 'made-up' } : entry)) },
  ), 'collected_finding_0_risk_class_invalid')
  // The policy digest is compared with the trusted current policy, never only shape-checked.
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE, collected, { expectedPolicySha256: DIGEST('9') },
  ), 'bundle_policy_digest_not_trusted')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE, collected, { expectedPolicySha256: undefined },
  ), 'trusted_policy_digest_required')
  // A fix claim must cite a server-observed independent re-review of the repair head
  // and only collector-verified regression locations; invented values do not pass.
  const withoutReReviews = { ...collected, reReviews: [] }
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE, withoutReReviews,
  ), 'finding_0_fix_evidence_not_server_observed')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, reReviews: collected.reReviews.map((record) => ({ ...record, headOid: SHA('c') })) },
  ), 'finding_0_fix_evidence_not_server_observed')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, reReviews: collected.reReviews.map((record) => ({ ...record, independent: false })) },
  ), 'finding_0_fix_evidence_not_server_observed')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, reReviews: collected.reReviews.map((record) => ({ ...record, regressionLocations: ['scripts/tests/other.mjs:1'] })) },
  ), 'finding_0_fix_evidence_not_server_observed')
  throwsCode('finding_disposition_invalid', () => validateBundle(
    validateFindingDispositionBundle, bundle, EXPECTED_CHECK_SOURCE,
    { ...collected, reReviews: [...collected.reReviews, collected.reReviews[0]] },
  ), 'collected_rereview_2_duplicated')
})

test('confirmed blocking findings cannot be accepted or deferred, unverified findings cannot resolve, and fixed claims need evidence', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const withFinding = (overrides, machineGate = null) => makeConvergedBundle({
    machineGate, findings: [makeFinding(overrides)],
  })
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'CRITICAL', disposition: 'ACCEPTED', fixedOnHead: false, fixEvidence: null, policyRule: 'not-allowed',
  })), 'finding_0_accepted_unfixed_blocking_finding')
  throwsCode('finding_disposition_incomplete', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P3', verification: 'unverified', disposition: 'FALSE_POSITIVE', fixedOnHead: false, fixEvidence: null,
  })), 'finding_0_verification_incomplete')
  // "Already addressed on this head" is a fix claim: a bare boolean cannot pass a P0 through ACCEPTED.
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P0', disposition: 'ACCEPTED', fixedOnHead: true, fixEvidence: null, policyRule: 'already-addressed-on-head',
  })), 'finding_0_accepted_fix_claim_without_regression_and_rereview_evidence')
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P0', disposition: 'ACCEPTED', fixedOnHead: false, policyRule: 'already-addressed-on-head',
  })), 'finding_0_fix_evidence_without_fixed_head')
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P3', verification: 'refuted', disposition: 'FALSE_POSITIVE', fixedOnHead: false, fixEvidence: null,
    evidence: ['ghp_12345678901234567890:1'],
  })))
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P3', inScope: false, disposition: 'DEFERRED', fixedOnHead: false, fixEvidence: null,
    followUpRef: 'https://github.com/another/repo/issues/1',
  })), 'finding_0_defer_contract_invalid')
  // An out-of-scope blocker cannot be waved through as ACCEPTED without a fix: it
  // defers to a same-repository issue or escalates.
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    severity: 'P2', inScope: false, disposition: 'ACCEPTED', fixedOnHead: false, fixEvidence: null, policyRule: 'outside-pr-scope',
  })), 'finding_0_accepted_unfixed_blocking_finding')
  assert.equal(validateBundle(validateFindingDispositionBundle, makeConvergedBundle({ findings: [makeFinding({
    severity: 'P2', inScope: false, disposition: 'DEFERRED', fixedOnHead: false, fixEvidence: null, policyRule: 'outside-pr-scope',
    followUpRef: 'https://github.com/monkey1sai/AI-BIM-governance/issues/901',
  })] })).status, 'passed')
  // "fixed" is not self-certifying: the claim needs the repair head, regression and independent re-review.
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    fixEvidence: null,
  })), 'finding_0_fix_claim_without_regression_and_rereview_evidence')
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    fixEvidence: { repairHeadOid: SHA('c'), regressionEvidence: ['scripts/tests/regression.mjs:10'], reReviewRef: 'codex-review-r2' },
  })), 'finding_0_fix_not_on_current_head')
  // A FIX_REQUIRED finding that has not been repaired keeps the bundle incomplete.
  throwsCode('finding_disposition_incomplete', () => validateBundle(validateFindingDispositionBundle, withFinding({
    fixedOnHead: false, fixEvidence: null, threadResolved: false,
  })), 'finding_0_fix_required_pending_repair')
  // High-risk classes never autonomous-merge.
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    riskClass: 'security',
  })), 'finding_0_high_risk_finding_requires_escalation')
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    riskClass: 'deployment', disposition: 'ESCALATE', fixedOnHead: false, fixEvidence: null, threadResolved: true,
  })), 'finding_0_escalated_thread_must_stay_open')
  throwsCode('finding_disposition_invalid', () => validateBundle(validateFindingDispositionBundle, withFinding({
    disposition: 'RESOLVED', fixedOnHead: false, fixEvidence: null,
  })), 'disposition_not_closed')
  const escalatedBundle = {
    ...makeConvergedBundle({
      findings: [makeFinding({
        riskClass: 'acl', disposition: 'ESCALATE', fixedOnHead: false, fixEvidence: null,
        threadResolved: false, verification: 'unverified',
      })],
    }),
    unresolvedThreads: 1,
  }
  const escalated = validateBundle(validateFindingDispositionBundle, escalatedBundle)
  assert.equal(escalated.status, 'escalated')
  assert.equal(escalated.reviewConverged, false)
})

test('machine gate is valid only after complete finding convergence on the same frozen head and binds the latest CheckRun', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const finding = makeFinding({
    severity: 'P3', verification: 'refuted', disposition: 'FALSE_POSITIVE', fixedOnHead: false, fixEvidence: null,
    policyRule: 'false-positive-evidence',
  })
  // The expected App succeeded on this head, but before the last thread was opened and resolved.
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
    machineGate: { checkRunId: 200, startedAt: '2026-09-01T07:58:00.000Z', completedAt: '2026-09-01T08:09:00.000Z' },
  }), EXPECTED_CHECK_SOURCE, undefined, {
    sameHeadCheckRuns: makeRuns(SHA('a'), [{ id: 200, conclusion: 'success', startedAt: '2026-09-01T07:58:00.000Z', completedAt: '2026-09-01T08:09:00.000Z' }]),
  }), 'machine_gate_started_before_finding_convergence')
  // Sharing the collector's observation instant is not "after" it.
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
    machineGate: { checkRunId: 200, startedAt: CONVERGENCE_AT, completedAt: '2026-09-01T08:09:00.000Z' },
  }), EXPECTED_CHECK_SOURCE, undefined, {
    sameHeadCheckRuns: makeRuns(SHA('a'), [{ id: 200, conclusion: 'success', startedAt: CONVERGENCE_AT, completedAt: '2026-09-01T08:09:00.000Z' }]),
  }), 'machine_gate_started_before_finding_convergence')
  // An older success cannot be selected when a newer rerun on the same head failed.
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
  }), EXPECTED_CHECK_SOURCE, undefined, {
    sameHeadCheckRuns: makeRuns(SHA('a'), [
      { id: 200, conclusion: 'success', startedAt: '2026-09-01T08:05:00.000Z', completedAt: '2026-09-01T08:09:00.000Z' },
      { id: 300, conclusion: 'failure', startedAt: '2026-09-01T08:20:00.000Z', completedAt: '2026-09-01T08:25:00.000Z' },
    ]),
  }), 'machine_gate_not_latest_same_head_check_run')
  // The run list is scoped to the expected source on the frozen head, and both the
  // list and the convergence epoch must come from the trusted collector.
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
  }), EXPECTED_CHECK_SOURCE, undefined, {
    sameHeadCheckRuns: makeRuns(SHA('a')).map((run) => ({ ...run, appId: 9999 })),
  }), 'same_head_check_run_0_not_expected_source_on_head')
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
  }), EXPECTED_CHECK_SOURCE, undefined, { convergenceObservedAt: undefined }), 'collector_convergence_epoch_required')
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding],
  }), EXPECTED_CHECK_SOURCE, undefined, { sameHeadCheckRuns: undefined }), 'collector_same_head_check_runs_required')
  throwsCode('finding_gate_order_invalid', () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
    findings: [finding], machineGate: { observedAfterConvergence: true },
  })), 'machine_gate_shape_invalid')
  assert.throws(
    () => validateBundle(validateFindingDispositionBundle, {
      ...makeConvergedBundle({ findings: [{ ...finding, threadResolved: false }], machineGate: null }),
      threadsComplete: false,
    }),
    (error) => error?.code === 'finding_disposition_incomplete',
  )
  assert.throws(
    () => validateBundle(validateFindingDispositionBundle, makeConvergedBundle({
      findings: [finding], machineGate: { name: 'candidate-workflow', appId: 9999 },
    }), null),
    (error) => error?.code === 'finding_gate_order_invalid',
  )
  assert.equal(validateBundle(validateFindingDispositionBundle, makeConvergedBundle({ findings: [finding] })).status, 'passed')
})

const buildMergePlanFixture = async () => {
  const { canonicalSha256, mergeOrderDependencyProof, subsumptionProof } = await loadSubject()
  const authoritativeDependencies = [
    { prNumber: 731, headOid: SHA('c'), predecessorPrNumbers: [] },
    { prNumber: 733, headOid: SHA('e'), predecessorPrNumbers: [731, 730] },
    { prNumber: 737, headOid: SHA('1'), predecessorPrNumbers: [733] },
    { prNumber: 730, headOid: SHA('3'), predecessorPrNumbers: [] },
  ]
  const dependencyGraphSha256 = canonicalSha256(
    [...authoritativeDependencies]
      .sort((left, right) => left.prNumber - right.prNumber)
      .map((entry) => ({ ...entry, predecessorPrNumbers: [...entry.predecessorPrNumbers].sort((a, b) => a - b) })),
  )
  const proof = (entry) => mergeOrderDependencyProof({ ...entry, dependencyGraphSha256 })
  const mergeOrder = [
    { prNumber: 731, headOid: SHA('c'), predecessorPrNumbers: [] },
    // 730 is subsumed by 733, so 733's authoritative edge to 730 collapses onto itself.
    { prNumber: 733, headOid: SHA('e'), predecessorPrNumbers: [731] },
    { prNumber: 737, headOid: SHA('1'), predecessorPrNumbers: [733] },
  ].map((entry) => ({ ...entry, dependencyProofSha256: proof(entry) }))
  const skip = { prNumber: 730, headOid: SHA('3'), disposition: 'SKIP_SUBSUMED', subsumedByPrNumber: 733 }
  const skips = [{ ...skip, proofSha256: subsumptionProof({ ...skip, subsumedByHeadOid: SHA('e') }) }]
  const plan = {
    schemaVersion: 'autonomous-delivery-subagent-merge-plan/v1',
    repository: 'monkey1sai/AI-BIM-governance', baseOid: SHA('a'),
    policySha256: DIGEST('b'), dependencyGraphSha256, generatedBy: {
      kind: 'subagent', taskId: 'pr-merge-order', model: 'gpt-5.6-sol',
      resultArtifactSha256: DIGEST('8'),
    },
    mergeOrder,
    skips,
  }
  const observedPrs = [
    { prNumber: 731, headOid: SHA('c') },
    { prNumber: 733, headOid: SHA('e') },
    { prNumber: 737, headOid: SHA('1') },
    { prNumber: 730, headOid: SHA('3') },
  ]
  const verifyProvenance = ({ contentSha256, generatedBy }) => (
    /^[0-9a-f]{64}$/.test(contentSha256) && generatedBy.resultArtifactSha256 === DIGEST('8')
  )
  const verifySubsumption = ({ prNumber, subsumedByPrNumber }) => prNumber === 730 && subsumedByPrNumber === 733
  return { plan, observedPrs, observedBaseOid: SHA('a'), verifyProvenance, verifySubsumption, authoritativeDependencies, proof }
}

test('merge plan is subagent-authored, bound to the authoritative dependency graph, and records verified subsumed PRs', async () => {
  const { validateSubagentMergePlan } = await loadSubject()
  const { plan, observedPrs, observedBaseOid, verifyProvenance, verifySubsumption, authoritativeDependencies } = await buildMergePlanFixture()
  const result = validateSubagentMergePlan(plan, { observedPrs, observedBaseOid, verifyProvenance, verifySubsumption, authoritativeDependencies })
  assert.deepEqual(result.mergeOrder.map((entry) => entry.prNumber), [731, 733, 737])
  assert.equal(result.skips[0].subsumedByPrNumber, 733)
  assert.equal(result.authorityVerified, true)
})

test('human-authored, dependency-inverted, incomplete-edge, or unproved skip merge plans fail closed', async () => {
  const { validateSubagentMergePlan } = await loadSubject()
  const { plan, observedPrs, observedBaseOid, verifyProvenance, verifySubsumption, authoritativeDependencies, proof } = await buildMergePlanFixture()
  const options = { observedPrs, observedBaseOid, verifyProvenance, verifySubsumption, authoritativeDependencies }
  // A predecessor merge moved the base: pre-merge ordering evidence must be recollected.
  throwsCode('merge_plan_head_drift', () => validateSubagentMergePlan(plan, { ...options, observedBaseOid: SHA('9') }), 'base_changed_after_plan')
  throwsCode('merge_plan_observation_invalid', () => validateSubagentMergePlan(plan, { ...options, observedBaseOid: undefined }), 'observed_base_oid_required')
  throwsCode('merge_plan_authority_invalid', () => validateSubagentMergePlan(
    { ...plan, generatedBy: { ...plan.generatedBy, kind: 'human' } }, options,
  ))
  throwsCode('merge_plan_dependency_invalid', () => validateSubagentMergePlan({
    ...plan, mergeOrder: [plan.mergeOrder[1], plan.mergeOrder[0], plan.mergeOrder[2]],
  }, options), 'merge_order_0_predecessor_not_earlier')
  // The subagent omitted a real edge (737 depends on 733): a signed but incomplete plan cannot invert the order.
  const omitted = { prNumber: 737, headOid: SHA('1'), predecessorPrNumbers: [] }
  throwsCode('merge_plan_dependency_invalid', () => validateSubagentMergePlan({
    ...plan, mergeOrder: [plan.mergeOrder[0], plan.mergeOrder[1], { ...omitted, dependencyProofSha256: proof(omitted) }],
  }, options), 'merge_order_2_predecessors_not_authoritative')
  throwsCode('merge_plan_dependency_invalid', () => validateSubagentMergePlan({
    ...plan, mergeOrder: [plan.mergeOrder[0], plan.mergeOrder[1], { ...plan.mergeOrder[2], dependencyProofSha256: DIGEST('f') }],
  }, options), 'merge_order_2_proof_not_recomputable')
  throwsCode('merge_plan_dependency_invalid', () => validateSubagentMergePlan(
    { ...plan, dependencyGraphSha256: DIGEST('9') }, options,
  ), 'dependency_graph_digest_not_authoritative')
  throwsCode('merge_plan_skip_invalid', () => validateSubagentMergePlan({
    ...plan, skips: [{ ...plan.skips[0], subsumedByPrNumber: 999 }],
  }, options), 'skip_0_lineage_invalid')
  throwsCode('merge_plan_skip_invalid', () => validateSubagentMergePlan(plan, {
    ...options, verifySubsumption: () => false,
  }), 'skip_0_subsumption_unverified')
  throwsCode('merge_plan_skip_invalid', () => validateSubagentMergePlan({
    ...plan, skips: [{ ...plan.skips[0], proofSha256: DIGEST('4') }],
  }, options), 'skip_0_proof_not_recomputable')
  throwsCode('merge_plan_authority_invalid', () => validateSubagentMergePlan(plan, { observedPrs, observedBaseOid, verifyProvenance, authoritativeDependencies }))
  throwsCode('merge_plan_authority_invalid', () => validateSubagentMergePlan(plan, { ...options, verifyProvenance: () => false }))
  throwsCode('merge_plan_head_drift', () => validateSubagentMergePlan(plan, {
    ...options,
    observedPrs: observedPrs.map((entry) => (entry.prNumber === 733 ? { ...entry, headOid: SHA('f') } : entry)),
  }))
})

test('review disposition replies carry hidden metadata, never re-trigger the agent, and dedupe on the exact tuple', async () => {
  const {
    buildReviewDispositionReply, parseReviewDispositionMetadata, isAgentGeneratedComment,
    selectFindingIntake, planReviewDispositionMutation, reviewDispositionTupleKey,
  } = await loadSubject()
  const finding = makeFinding({
    id: 'PRRC_3902413013', threadId: 'PRRT_kwDOSPoer86eCOH0', source: 'reviewer',
    fixedOnHead: false, fixEvidence: null, threadResolved: false,
  })
  const input = {
    repository: REPOSITORY, prNumber: 737, finding, headOid: SHA('a'), baseOid: SHA('b'),
    agentRunId: 'claude-d23c2a-run-1', sender: 'monkey1sai', webhookEventId: 'review_comment:3902413013',
    rationale: 'Confirmed on the current head: an invalid Date makes every expiry comparison false, so the lease check must fail closed before expiry math.',
    nextAction: 'Repair on a batch head, add a regression, then request an independent re-review.',
    evidenceSha256: DIGEST('c'),
  }
  const reply = buildReviewDispositionReply(input)
  assert.match(reply.body, /\*\*Review Disposition: `FIX_REQUIRED`\*\*/)
  assert.match(reply.body, /not an approval and not merge authority/)
  assert.equal(isAgentGeneratedComment(reply.body), true)
  const parsed = parseReviewDispositionMetadata(reply.body)
  assert.equal(parsed.finding_id, 'PRRC_3902413013')
  assert.equal(parsed.head_sha, SHA('a'))
  assert.equal(parsed.disposition, 'FIX_REQUIRED')
  assert.equal(parsed.fixed_on_head, false)
  assert.equal(reviewDispositionTupleKey(parsed), reply.tupleKey)
  assert.equal(parseReviewDispositionMetadata('plain human comment'), null)
  // A marker written before fixed_on_head joined the key set is still agent output and never a fix claim.
  const legacyMetadata = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'fixed_on_head'))
  const legacy = parseReviewDispositionMetadata(`<!-- ai-bim-review-disposition/v1 ${JSON.stringify(legacyMetadata)} -->`)
  assert.equal(legacy.fixed_on_head, false)
  assert.equal(reviewDispositionTupleKey(legacy), reply.tupleKey)
  throwsCode('review_disposition_metadata_invalid', () => parseReviewDispositionMetadata('<!-- ai-bim-review-disposition/v1 {not json} -->'))
  // A rationale that mentions a reviewer bot would recursively trigger it.
  throwsCode('review_disposition_invalid', () => buildReviewDispositionReply({
    ...input, rationale: 'Please @codex review this again because the check is wrong here.',
  }), 'rationale_invalid_contains_agent_mention_trigger')
  throwsCode('review_disposition_invalid', () => buildReviewDispositionReply({
    ...input, rationale: 'Token ghp_1234567890abcdefghij leaked into the rationale by mistake.',
  }), 'rationale_invalid_contains_secret')
  // The assembled body is checked as a whole, so an evidence location cannot smuggle a mention.
  throwsCode('review_disposition_invalid', () => buildReviewDispositionReply({
    ...input, finding: { ...finding, evidence: ['@codex re-run the gate:12'] },
  }), 'rendered_body_invalid_contains_agent_mention_trigger')
  // A high-risk finding cannot be dispositioned FIX_REQUIRED by the agent.
  throwsCode('finding_disposition_invalid', () => buildReviewDispositionReply({
    ...input, finding: { ...finding, riskClass: 'credentials' },
  }), 'finding_high_risk_finding_requires_escalation')

  // Only the server-reported author decides what is agent output: a marker pasted by
  // another author cannot hide that author's finding, and the sender's own comments
  // are never intake regardless of their text.
  const intake = selectFindingIntake([
    { id: 1, author: 'chatgpt-codex-connector', body: 'P2 finding text' },
    { id: 2, author: 'monkey1sai', body: reply.body },
    { id: 3, author: 'monkey1sai', body: 'coordinator note without marker' },
    { id: 4, author: 'someone', body: '<!-- ai-bim-review-disposition/v1 pasted marker -->' },
    { id: 5, author: 'human-reviewer', body: ['> ' + reply.body.split('\n').at(-1), '', 'Still broken on my machine, see line 40.'].join('\n') },
  ], { agentSender: 'monkey1sai' })
  // The sender's own unmarked review finding is intake: author alone never silences a finding.
  assert.deepEqual(intake.map((comment) => comment.id), [1, 3, 4, 5])
  throwsCode('review_disposition_invalid', () => selectFindingIntake([], {}), 'agent_sender_required')

  const own = (body) => ({ author: 'monkey1sai', body })
  assert.deepEqual(planReviewDispositionMutation({ existingComments: [{ author: 'chatgpt-codex-connector', body: 'P2 finding text' }], candidateMetadata: reply.metadata }), {
    action: 'post', reason: 'new_disposition_for_finding_on_head',
  })
  assert.deepEqual(planReviewDispositionMutation({ existingComments: [own(reply.body)], candidateMetadata: reply.metadata }), {
    action: 'skip', reason: 'duplicate_exact_tuple',
  })
  const rerun = buildReviewDispositionReply({ ...input, agentRunId: 'claude-d23c2a-run-2', webhookEventId: 'manual:rerun' })
  assert.deepEqual(planReviewDispositionMutation({ existingComments: [own(reply.body)], candidateMetadata: rerun.metadata }), {
    action: 'skip', reason: 'already_dispositioned_on_head',
  })
  const newHead = buildReviewDispositionReply({ ...input, headOid: SHA('d') })
  assert.equal(planReviewDispositionMutation({ existingComments: [own(reply.body)], candidateMetadata: newHead.metadata }).action, 'post')
  // Same head, but main moved underneath it or the finding text changed: a new integration state.
  const newBase = buildReviewDispositionReply({ ...input, agentRunId: 'claude-d23c2a-run-3', baseOid: SHA('e') })
  assert.equal(planReviewDispositionMutation({ existingComments: [own(reply.body)], candidateMetadata: newBase.metadata }).action, 'post')
  const newEvidence = buildReviewDispositionReply({ ...input, agentRunId: 'claude-d23c2a-run-4', evidenceSha256: DIGEST('f') })
  assert.equal(planReviewDispositionMutation({ existingComments: [own(reply.body)], candidateMetadata: newEvidence.metadata }).action, 'post')
  assert.deepEqual(planReviewDispositionMutation({
    existingComments: [own('<!-- ai-bim-review-disposition/v1 {"broken":true} -->')], candidateMetadata: reply.metadata,
  }), { action: 'hold', reason: 'existing_agent_metadata_unparseable' })
  // Another author's copy of the marker, malformed or not, never skips or holds the agent.
  assert.equal(planReviewDispositionMutation({
    existingComments: [{ author: 'someone', body: reply.body }, { author: 'someone', body: '<!-- ai-bim-review-disposition/v1 {"broken":true} -->' }],
    candidateMetadata: reply.metadata,
  }).action, 'post')
})
