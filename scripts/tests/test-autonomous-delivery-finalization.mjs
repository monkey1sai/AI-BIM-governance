import assert from 'node:assert/strict'
import test from 'node:test'

const loadSubject = () => import('../lib/autonomous-delivery-finalization.mjs')

const SHA = (value) => value.repeat(40)
const DIGEST = (value) => value.repeat(64)
const REPOSITORY = 'monkey1sai/AI-BIM-governance'
const EXPECTED_CHECK_SOURCE = Object.freeze({ name: 'autonomous-delivery-gate', appId: 4242 })

const makeConvergedBundle = ({
  headOid = SHA('a'),
  repository = REPOSITORY,
  baseOid = SHA('b'),
  machineGate = {},
} = {}) => ({
  schemaVersion: 'autonomous-delivery-finding-disposition/v1',
  repository,
  prNumber: 737,
  baseOid,
  headOid,
  policySha256: DIGEST('b'),
  threadsComplete: true,
  unresolvedThreads: 0,
  machineGate: {
    name: 'autonomous-delivery-gate', appId: 4242, headOid,
    conclusion: 'success', observedAfterConvergence: true, ...machineGate,
  },
  findings: [],
})

const expectCode = async (code, callback) => {
  await assert.rejects(callback, (error) => error?.code === code)
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
    diff: 'diff --git a/docs/a.md b/docs/a.md\n+source-pinned contract',
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
  }, { expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE }), (error) => error?.code === 'required_check_not_authoritative')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }), (error) => error?.code === 'finding_gate_order_invalid')
  assert.throws(() => applyFinalizationEvent({ ...state, rounds: [] }, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }, { expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE }), (error) => error?.code === 'finalization_state_invalid')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'),
    findingBundle: makeConvergedBundle({ repository: 'attacker/other-repo' }),
  }, { expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE }), (error) => error?.code === 'finalization_event_invalid')
  assert.throws(() => applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'),
    findingBundle: makeConvergedBundle({ baseOid: SHA('d') }),
  }, { expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE }), (error) => error?.code === 'finalization_event_invalid')
  state = applyFinalizationEvent(state, {
    type: 'round_converged', headOid: SHA('a'), findingBundle: makeConvergedBundle(),
  }, { expectedRequiredCheckSource: EXPECTED_CHECK_SOURCE })
  assert.equal(state.phase, 'READY_TO_MERGE')
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

test('adversarial decision requires distinct models, raw packet binding, and G1-G12 pass', async () => {
  const { validateAdversarialDecision } = await loadSubject()
  const rubric = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    `G${index + 1}`, { status: 'pass', evidence: `scripts/tests/evidence-${index + 1}.json:1` },
  ]))
  const decision = {
    packetSha256: DIGEST('a'),
    layers: {
      l1: { model: 'finder-model', output: 'closed', findings: [] },
      l2: { model: 'refuter-model', output: 'closed', killed: [], surviving: [], unverified: [] },
      l3: {
        model: 'apex-model', output: 'closed', packetSha256: DIGEST('a'),
        verdict: 'passed', unresolvedHighCritical: [], rubric,
      },
    },
  }
  assert.equal(validateAdversarialDecision(decision).verdict, 'passed')
  assert.throws(() => validateAdversarialDecision({
    ...decision,
    layers: { ...decision.layers, l2: { ...decision.layers.l2, model: 'finder-model' } },
  }), (error) => error?.code === 'adversarial_independence_invalid')
  assert.throws(() => validateAdversarialDecision({
    ...decision,
    layers: {
      ...decision.layers,
      l3: { ...decision.layers.l3, rubric: { ...rubric, G7: { status: 'uncertain', evidence: 'none:1' } } },
    },
  }), (error) => error?.code === 'activation_unattested')
})

test('merge preparation is exact-head CAS and refuses partial threads or stale state', async () => {
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
    expiresAt: '2026-09-01T08:10:00.000Z', consumed: false,
  }
  assert.deepEqual(buildExactHeadMergeRequest(snapshot, lease, {
    now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash',
  }), { method: 'squash', sha: SHA('a') })
  assert.throws(() => buildExactHeadMergeRequest(
    { ...snapshot, threadsComplete: false }, lease,
    { now: new Date('2026-09-01T08:00:00.000Z'), method: 'squash' },
  ), (error) => error?.code === 'premerge_evidence_invalid')
})

test('single-flight lock keeps ordinary PRs queued until terminal delivery', async () => {
  const { createSingleFlightLedger } = await loadSubject()
  let ledger = createSingleFlightLedger('monkey1sai/AI-BIM-governance')
  ;({ ledger } = ledger.acquire({ deliveryId: 'delivery-737', prClass: 'ordinary' }))
  assert.throws(
    () => ledger.acquire({ deliveryId: 'delivery-738', prClass: 'ordinary' }),
    (error) => error?.code === 'delivery_lock_held',
  )
  ledger = ledger.close({ deliveryId: 'delivery-737', terminalClass: 'DELIVERED', reasonCode: 'DELIVERY_VERIFIED' })
  assert.equal(ledger.acquire({ deliveryId: 'delivery-738', prClass: 'ordinary' }).lease.deliveryId, 'delivery-738')
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

test('CI findings converge through FIX, REJECT, ACCEPT_RISK, or DEFER without equating resolution to a code fix', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const bundle = {
    schemaVersion: 'autonomous-delivery-finding-disposition/v1',
    repository: REPOSITORY, prNumber: 737, baseOid: SHA('b'),
    headOid: SHA('a'), policySha256: DIGEST('b'), threadsComplete: true,
    unresolvedThreads: 0,
    machineGate: {
      name: 'autonomous-delivery-gate', appId: 4242, conclusion: 'success', headOid: SHA('a'),
      observedAfterConvergence: true,
    },
    findings: [
      {
        id: 'ci-1', threadId: 'thread-1', source: 'ci', severity: 'P2',
        verification: 'confirmed', inScope: true, disposition: 'FIX',
        fixedOnHead: true, evidence: ['scripts/tests/regression.mjs:10'],
        policyRule: 'confirmed-p2-in-scope', followUpRef: null, threadResolved: true,
      },
      {
        id: 'review-2', threadId: 'thread-2', source: 'reviewer', severity: 'P3',
        verification: 'confirmed', inScope: true, disposition: 'ACCEPT_RISK',
        fixedOnHead: false, evidence: ['docs/agents/github-workflow.md:1'],
        policyRule: 'nonblocking-naming-advisory', followUpRef: null, threadResolved: true,
      },
      {
        id: 'review-3', threadId: 'thread-3', source: 'reviewer', severity: 'HIGH',
        verification: 'refuted', inScope: true, disposition: 'REJECT',
        fixedOnHead: false, evidence: ['scripts/tests/regression.mjs:20'],
        policyRule: 'false-positive-evidence', followUpRef: null, threadResolved: true,
      },
      {
        id: 'ci-4', threadId: 'thread-4', source: 'deterministic', severity: 'MEDIUM',
        verification: 'confirmed', inScope: false, disposition: 'DEFER',
        fixedOnHead: false, evidence: ['docs/agents/github-workflow.md:2'],
        policyRule: 'outside-pr-scope',
        followUpRef: 'https://github.com/monkey1sai/AI-BIM-governance/issues/900',
        threadResolved: true,
      },
    ],
  }
  const result = validateFindingDispositionBundle(bundle, EXPECTED_CHECK_SOURCE)
  assert.equal(result.status, 'passed')
  assert.equal(result.reviewConverged, true)
  assert.equal(result.findings.filter((finding) => finding.fixedOnHead).length, 1)
})

test('confirmed blocking findings cannot be accepted or deferred and unverified findings cannot resolve', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const base = {
    schemaVersion: 'autonomous-delivery-finding-disposition/v1',
    repository: REPOSITORY, prNumber: 737, baseOid: SHA('b'),
    headOid: SHA('a'), policySha256: DIGEST('b'), threadsComplete: true,
    unresolvedThreads: 0,
    machineGate: null,
    findings: [{
      id: 'ci-1', threadId: 'thread-1', source: 'ci', severity: 'CRITICAL',
      verification: 'confirmed', inScope: true, disposition: 'ACCEPT_RISK',
      fixedOnHead: false, evidence: ['scripts/tests/regression.mjs:10'],
      policyRule: 'not-allowed', followUpRef: null, threadResolved: true,
    }],
  }
  assert.throws(
    () => validateFindingDispositionBundle(base, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_disposition_invalid',
  )
  assert.throws(
    () => validateFindingDispositionBundle({
      ...base,
      findings: [{ ...base.findings[0], severity: 'P3', verification: 'unverified', disposition: 'REJECT' }],
    }, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_disposition_incomplete',
  )
  assert.throws(
    () => validateFindingDispositionBundle({
      ...base,
      findings: [{
        ...base.findings[0], severity: 'P3', verification: 'refuted', disposition: 'REJECT',
        evidence: ['ghp_12345678901234567890:1'],
      }],
    }, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_disposition_invalid',
  )
  assert.throws(
    () => validateFindingDispositionBundle({
      ...base,
      findings: [{
        ...base.findings[0], severity: 'P3', verification: 'confirmed', inScope: false,
        disposition: 'DEFER', followUpRef: 'https://github.com/another/repo/issues/1',
      }],
    }, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_disposition_invalid',
  )
})

test('machine gate is valid only after complete finding convergence on the same frozen head', async () => {
  const { validateFindingDispositionBundle } = await loadSubject()
  const finding = {
    id: 'ci-1', threadId: 'thread-1', source: 'ci', severity: 'P3',
    verification: 'refuted', inScope: true, disposition: 'REJECT',
    fixedOnHead: false, evidence: ['scripts/tests/regression.mjs:10'],
    policyRule: 'false-positive-evidence', followUpRef: null, threadResolved: true,
  }
  const bundle = {
    schemaVersion: 'autonomous-delivery-finding-disposition/v1',
    repository: REPOSITORY, prNumber: 737, baseOid: SHA('b'),
    headOid: SHA('a'), policySha256: DIGEST('b'), threadsComplete: true,
    unresolvedThreads: 0, findings: [finding],
    machineGate: {
      name: 'autonomous-delivery-gate', appId: 4242, conclusion: 'success', headOid: SHA('a'),
      observedAfterConvergence: false,
    },
  }
  assert.throws(
    () => validateFindingDispositionBundle(bundle, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_gate_order_invalid',
  )
  assert.throws(
    () => validateFindingDispositionBundle({
      ...bundle,
      machineGate: null,
      threadsComplete: false,
      findings: [{ ...finding, threadResolved: false }],
    }, EXPECTED_CHECK_SOURCE),
    (error) => error?.code === 'finding_disposition_incomplete',
  )
  assert.throws(
    () => validateFindingDispositionBundle({
      ...bundle,
      machineGate: { ...bundle.machineGate, name: 'candidate-workflow', appId: 9999, observedAfterConvergence: true },
    }),
    (error) => error?.code === 'finding_gate_order_invalid',
  )
})

test('merge plan is subagent-authored, dependency ordered, and records subsumed PRs', async () => {
  const { validateSubagentMergePlan } = await loadSubject()
  const plan = {
    schemaVersion: 'autonomous-delivery-subagent-merge-plan/v1',
    repository: 'monkey1sai/AI-BIM-governance', baseOid: SHA('a'),
    policySha256: DIGEST('b'), dependencyGraphSha256: DIGEST('9'), generatedBy: {
      kind: 'subagent', taskId: 'pr-merge-order', model: 'gpt-5.6-sol',
      resultArtifactSha256: DIGEST('8'),
    },
    mergeOrder: [
      { prNumber: 731, headOid: SHA('c'), predecessorPrNumbers: [], dependencyProofSha256: DIGEST('d') },
      { prNumber: 733, headOid: SHA('e'), predecessorPrNumbers: [731], dependencyProofSha256: DIGEST('f') },
      { prNumber: 737, headOid: SHA('1'), predecessorPrNumbers: [733], dependencyProofSha256: DIGEST('2') },
    ],
    skips: [
      { prNumber: 730, headOid: SHA('3'), disposition: 'SKIP_SUBSUMED', subsumedByPrNumber: 733, proofSha256: DIGEST('4') },
    ],
  }
  const observedPrs = [
    { prNumber: 731, headOid: SHA('c') },
    { prNumber: 733, headOid: SHA('e') },
    { prNumber: 737, headOid: SHA('1') },
    { prNumber: 730, headOid: SHA('3') },
  ]
  const result = validateSubagentMergePlan(plan, {
    observedPrs,
    verifyProvenance: ({ contentSha256, generatedBy }) => (
      /^[0-9a-f]{64}$/.test(contentSha256) && generatedBy.resultArtifactSha256 === DIGEST('8')
    ),
  })
  assert.deepEqual(result.mergeOrder.map((entry) => entry.prNumber), [731, 733, 737])
  assert.equal(result.skips[0].subsumedByPrNumber, 733)
  assert.equal(result.authorityVerified, true)
})

test('human-authored, dependency-inverted, or unproved skip merge plans fail closed', async () => {
  const { validateSubagentMergePlan } = await loadSubject()
  const base = {
    schemaVersion: 'autonomous-delivery-subagent-merge-plan/v1',
    repository: 'monkey1sai/AI-BIM-governance', baseOid: SHA('a'),
    policySha256: DIGEST('b'), dependencyGraphSha256: DIGEST('9'), generatedBy: {
      kind: 'subagent', taskId: 'pr-merge-order', model: 'gpt-5.6-sol',
      resultArtifactSha256: DIGEST('8'),
    },
    mergeOrder: [
      { prNumber: 731, headOid: SHA('c'), predecessorPrNumbers: [], dependencyProofSha256: DIGEST('d') },
      { prNumber: 733, headOid: SHA('e'), predecessorPrNumbers: [731], dependencyProofSha256: DIGEST('f') },
    ],
    skips: [],
  }
  const observedPrs = [
    { prNumber: 731, headOid: SHA('c') },
    { prNumber: 733, headOid: SHA('e') },
  ]
  const verifyProvenance = () => true
  assert.throws(
    () => validateSubagentMergePlan(
      { ...base, generatedBy: { ...base.generatedBy, kind: 'human' } },
      { observedPrs, verifyProvenance },
    ),
    (error) => error?.code === 'merge_plan_authority_invalid',
  )
  assert.throws(
    () => validateSubagentMergePlan({
      ...base,
      mergeOrder: [base.mergeOrder[1], base.mergeOrder[0]],
    }, { observedPrs, verifyProvenance }),
    (error) => error?.code === 'merge_plan_dependency_invalid',
  )
  assert.throws(
    () => validateSubagentMergePlan({
      ...base,
      skips: [{ prNumber: 730, headOid: SHA('3'), disposition: 'SKIP_SUBSUMED', subsumedByPrNumber: 999, proofSha256: DIGEST('4') }],
    }, { observedPrs: [...observedPrs, { prNumber: 730, headOid: SHA('3') }], verifyProvenance }),
    (error) => error?.code === 'merge_plan_skip_invalid',
  )
  assert.throws(
    () => validateSubagentMergePlan(base, { observedPrs }),
    (error) => error?.code === 'merge_plan_authority_invalid',
  )
  assert.throws(
    () => validateSubagentMergePlan(base, { observedPrs, verifyProvenance: () => false }),
    (error) => error?.code === 'merge_plan_authority_invalid',
  )
  assert.throws(
    () => validateSubagentMergePlan(base, {
      observedPrs: [{ prNumber: 731, headOid: SHA('c') }, { prNumber: 733, headOid: SHA('f') }],
      verifyProvenance,
    }),
    (error) => error?.code === 'merge_plan_head_drift',
  )
})
