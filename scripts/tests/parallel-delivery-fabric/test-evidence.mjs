import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

import {
  EVIDENCE_SCHEMA_VERSION,
  TRUSTED_EVIDENCE_CONTEXT_VERSION,
  reduceEvidenceContract,
} from '../../lib/parallel-delivery-fabric-evidence.mjs'

const require = createRequire(import.meta.url)
const SHA1 = character => character.repeat(40)
const SHA256 = character => character.repeat(64)
const SUBJECT = SHA1('a')
const BASE = SHA1('b')
const MANIFEST = SHA256('c')
const DESIGN = SHA256('d')
const ACTIVATION = SHA256('e')
const ROLLBACK = SHA256('f')
const GATE = SHA256('2')
const APPLICABILITY = SHA256('1')
const BASE_SOURCE_KINDS = Object.freeze(['DESIGN', 'ACTIVATION', 'ROLLBACK', 'GATE'])
const HELD_REASON_BY_CLASSIFICATION = Object.freeze({
  PARTIAL: 'PARTIAL_EVIDENCE',
  HELD: 'HELD_PENDING_EVIDENCE',
  FAILED: 'FAILED_EVIDENCE',
})

const acceptanceId = number => `AC-${String(number).padStart(2, '0')}`
const freeze = value => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freeze(nested)
  return Object.freeze(value)
}

const sourceRefs = id => [
  { kind: 'DESIGN', ref: 'design:approved_design', digest: DESIGN },
  { kind: 'ACTIVATION', ref: 'activation:task9', digest: ACTIVATION },
  { kind: 'ROLLBACK', ref: 'rollback:single_writer', digest: ROLLBACK },
  { kind: 'GATE', ref: `gate:evidence_${id.toLowerCase().replace('-', '_')}`, digest: GATE },
]

const requiredKinds = number => [number === 22 ? 'PLAYWRIGHT' : number === 26 ? 'COMPUTER_USE' : 'CONTRACT']

const gate = (id, kind, overrides = {}) => ({
  gate_id: `gate:${id.toLowerCase().replace('-', '_')}`,
  kind,
  required: true,
  status: 'passed',
  terminal: true,
  current_exact_head: true,
  subject_sha: SUBJECT,
  base_sha: BASE,
  manifest_digest: MANIFEST,
  source_ref: `gate:evidence_${id.toLowerCase().replace('-', '_')}`,
  source_digest: GATE,
  ...overrides,
})

const record = (number, overrides = {}) => {
  const id = acceptanceId(number)
  return {
    id,
    classification: 'PASSED',
    subject_sha: SUBJECT,
    base_sha: BASE,
    manifest_digest: MANIFEST,
    source_refs: sourceRefs(id),
    gate_outcomes: [gate(id, requiredKinds(number)[0])],
    held_reasons: [],
    activation: { ref: 'activation:task9', digest: ACTIVATION, status: 'CURRENT' },
    rollback: { ref: 'rollback:single_writer', digest: ROLLBACK },
    applicability: { kind: 'REQUIRED' },
    ...overrides,
  }
}

const bundle = (overrides = {}) => ({
  schema_version: EVIDENCE_SCHEMA_VERSION,
  records: Array.from({ length: 45 }, (_, index) => record(index + 1)),
  ...overrides,
})

const replaceRecord = (records, index, transform) => records.map((entry, current) => (
  current === index ? transform(structuredClone(entry)) : entry
))

const expectedAcceptance = number => ({
  id: acceptanceId(number),
  required_gate_kinds: requiredKinds(number),
  required_source_kinds: [...BASE_SOURCE_KINDS],
  applicability: { kind: 'REQUIRED' },
})

const trustedContext = (overrides = {}) => freeze({
  schema_version: TRUSTED_EVIDENCE_CONTEXT_VERSION,
  subject_sha: SUBJECT,
  base_sha: BASE,
  manifest_digest: MANIFEST,
  activation: { ref: 'activation:task9', digest: ACTIVATION, status: 'CURRENT' },
  rollback: { ref: 'rollback:single_writer', digest: ROLLBACK },
  acceptance: Array.from({ length: 45 }, (_, index) => expectedAcceptance(index + 1)),
  ...overrides,
})

const contextWithAcceptance = (index, transform, overrides = {}) => {
  const raw = structuredClone(trustedContext())
  raw.acceptance = replaceRecord(raw.acceptance, index, transform)
  return trustedContext({ ...raw, ...overrides, acceptance: raw.acceptance })
}

const notApplicableRecord = value => ({
  ...value,
  classification: 'NOT_APPLICABLE',
  source_refs: [...value.source_refs, {
    kind: 'APPLICABILITY', ref: 'applicability:base_policy', digest: APPLICABILITY,
  }],
  gate_outcomes: [gate(value.id, 'POLICY')],
  applicability: {
    kind: 'NOT_APPLICABLE',
    authority_ref: 'applicability:base_policy',
    authority_digest: APPLICABILITY,
    base_sha: BASE,
    prior_pinned: true,
    immutable: true,
    current_exact_head: true,
  },
})

const trustedNotApplicable = () => contextWithAcceptance(0, value => ({
  ...value,
  required_gate_kinds: ['POLICY'],
  required_source_kinds: [...BASE_SOURCE_KINDS, 'APPLICABILITY'],
  applicability: {
    kind: 'NOT_APPLICABLE',
    authority_ref: 'applicability:base_policy',
    authority_digest: APPLICABILITY,
    base_sha: BASE,
    prior_pinned: true,
    immutable: true,
    current_exact_head: true,
  },
}))

test('P0 RED — synchronously recomputed candidate and frozen matching context remain authority-required, never COMPLETE', () => {
  const result = reduceEvidenceContract(bundle(), trustedContext())
  assert.equal(result.status, 'HELD')
  assert.equal(result.complete, false)
  assert.equal(result.reason, 'TRUSTED_CONTEXT_AUTHORITY_REQUIRED')
  assert.equal(result.advisory_eligible, true)
})

test('P0 — candidate rows and flags cannot self-authorize completion even with a separate frozen trusted expected context', () => {
  const candidate = bundle()
  const missing = reduceEvidenceContract(candidate)
  assert.equal(missing.status, 'REJECTED')
  assert.equal(missing.complete, false)

  const rawContext = structuredClone(trustedContext())
  assert.equal(reduceEvidenceContract(candidate, rawContext).status, 'REJECTED')

  const advisory = reduceEvidenceContract(candidate, trustedContext())
  assert.equal(advisory.status, 'HELD')
  assert.equal(advisory.complete, false)
  assert.equal(advisory.advisory_eligible, true)
  assert.equal(advisory.reason, 'TRUSTED_CONTEXT_AUTHORITY_REQUIRED')
  assert.match(advisory.trusted_context_digest, /^[0-9a-f]{64}$/u)

  const shallowFrozen = Object.freeze(structuredClone(trustedContext()))
  assert.equal(reduceEvidenceContract(candidate, shallowFrozen).status, 'REJECTED')
  const closedShapeDrift = structuredClone(trustedContext())
  closedShapeDrift.unexpected = true
  assert.equal(reduceEvidenceContract(candidate, freeze(closedShapeDrift)).status, 'REJECTED')
  assert.equal(reduceEvidenceContract(candidate, trustedContext({ subject_sha: BASE })).status, 'REJECTED')
  assert.equal(reduceEvidenceContract({ ...candidate, trusted_context: trustedContext() }, trustedContext()).status, 'REJECTED')
  assert.equal(reduceEvidenceContract(candidate, new Proxy(trustedContext(), {})).status, 'REJECTED')
  assert.equal(Object.isFrozen(advisory), true)
})

test('P0 — trusted context is a closed AC-to-gate/source map and pins activation, rollback, and applicability authority', () => {
  const candidate = bundle()
  const mapDrift = contextWithAcceptance(0, value => ({ ...value, required_gate_kinds: ['POLICY'] }))
  assert.equal(reduceEvidenceContract(candidate, mapDrift).status, 'REJECTED')
  assert.equal(reduceEvidenceContract(candidate, trustedContext({ rollback: { ref: 'rollback:other_plan', digest: ROLLBACK } })).status, 'REJECTED')

  const notApplicable = bundle({ records: replaceRecord(bundle().records, 0, notApplicableRecord) })
  assert.equal(reduceEvidenceContract(notApplicable, trustedContext()).status, 'REJECTED')
  assert.equal(reduceEvidenceContract(notApplicable, trustedNotApplicable()).status, 'HELD')
})

test('closed evidence reducer rejects missing, duplicate, out-of-range, unknown-classification, and extra acceptance rows', () => {
  const context = trustedContext()
  const cases = [
    bundle({ records: bundle().records.slice(0, 44) }),
    bundle({ records: [...bundle().records.slice(0, 44), record(44)] }),
    bundle({ records: [...bundle().records.slice(0, 44), record(46)] }),
    bundle({ records: replaceRecord(bundle().records, 0, value => ({ ...value, classification: 'UNKNOWN' })) }),
    bundle({ records: replaceRecord(bundle().records, 0, value => ({ ...value, unexpected: true })) }),
  ]

  for (const candidate of cases) {
    const result = reduceEvidenceContract(candidate, context)
    assert.equal(result.status, 'REJECTED')
    assert.equal(result.complete, false)
  }
})

test('PARTIAL, HELD, FAILED, nonterminal, stale, and non-passing required gates cannot complete', () => {
  const context = trustedContext()
  for (const classification of ['PARTIAL', 'HELD', 'FAILED']) {
    const records = replaceRecord(bundle().records, 0, value => ({
      ...value,
      classification,
      held_reasons: [HELD_REASON_BY_CLASSIFICATION[classification]],
    }))
    assert.equal(reduceEvidenceContract(bundle({ records }), context).status, 'INCOMPLETE', classification)
  }

  for (const status of ['failed', 'not_run', 'skipped', 'not_configured']) {
    const records = replaceRecord(bundle().records, 0, value => ({
      ...value,
      gate_outcomes: [{ ...value.gate_outcomes[0], status }],
    }))
    assert.equal(reduceEvidenceContract(bundle({ records }), context).status, 'INCOMPLETE', status)
  }

  for (const gateOverrides of [{ terminal: false }, { current_exact_head: false }]) {
    const records = replaceRecord(bundle().records, 0, value => ({
      ...value,
      gate_outcomes: [{ ...value.gate_outcomes[0], ...gateOverrides }],
    }))
    assert.equal(reduceEvidenceContract(bundle({ records }), context).status, 'INCOMPLETE')
  }
})

test('P2 — optional gates are non-bearing, while trusted AC-required gates remain terminal and current', () => {
  const candidate = bundle({
    records: replaceRecord(bundle().records, 0, value => ({
      ...value,
      gate_outcomes: [
        ...value.gate_outcomes,
        gate(value.id, 'POLICY', { gate_id: 'gate:optional_policy', required: false, status: 'failed', terminal: false, current_exact_head: false }),
      ],
    })),
  })
  assert.equal(reduceEvidenceContract(candidate, trustedContext()).status, 'HELD')

  const requiredFailure = bundle({
    records: replaceRecord(bundle().records, 0, value => ({
      ...value,
      gate_outcomes: [{ ...value.gate_outcomes[0], status: 'failed' }],
    })),
  })
  assert.equal(reduceEvidenceContract(requiredFailure, trustedContext()).status, 'INCOMPLETE')

  const notApplicable = bundle({
    records: replaceRecord(bundle().records, 0, value => ({
      ...notApplicableRecord(value),
      gate_outcomes: [gate(value.id, 'POLICY', { required: false })],
    })),
  })
  assert.equal(reduceEvidenceContract(notApplicable, trustedNotApplicable()).status, 'REJECTED')
})

test('Task9 activation gaps and missing independent browser evidence cannot be represented as COMPLETE', () => {
  const activationGap = bundle({
    records: bundle().records.map(value => ({
      ...value,
      activation: { ...value.activation, status: 'TASK9_EXTERNAL_ACTIVATION_GAP' },
    })),
  })
  const activationContext = trustedContext({
    activation: { ref: 'activation:task9', digest: ACTIVATION, status: 'TASK9_EXTERNAL_ACTIVATION_GAP' },
  })
  const gapResult = reduceEvidenceContract(activationGap, activationContext)
  assert.equal(gapResult.status, 'INCOMPLETE')
  assert.ok(gapResult.blockers.includes('TASK9_EXTERNAL_ACTIVATION_GAP'))

  const noBrowserEvidence = bundle({
    records: replaceRecord(bundle().records, 21, value => ({ ...value, gate_outcomes: [gate(value.id, 'CONTRACT')] })),
  })
  assert.equal(reduceEvidenceContract(noBrowserEvidence, trustedContext()).status, 'REJECTED')
})

const isolatedMutationCorpus = () => [
  {
    name: 'candidate extra root field',
    candidate: { ...bundle(), forged_context: 'candidate-controlled' },
    context: trustedContext(),
    expected: 'REJECTED',
    schemaAssertion: schema => schema.additionalProperties === false,
  },
  {
    name: 'unknown candidate classification',
    candidate: bundle({ records: replaceRecord(bundle().records, 0, value => ({ ...value, classification: 'UNKNOWN' })) }),
    context: trustedContext(),
    expected: 'REJECTED',
    schemaAssertion: schema => !schema.$defs.classification.enum.includes('UNKNOWN'),
  },
  {
    name: 'multiple-colon durable reference',
    candidate: bundle({
      records: replaceRecord(bundle().records, 0, value => ({
        ...value,
        source_refs: [{ ...value.source_refs[0], ref: 'design:approved:drift' }, ...value.source_refs.slice(1)],
      })),
    }),
    context: trustedContext(),
    expected: 'REJECTED',
    schemaAssertion: schema => !new RegExp(schema.$defs.reference_id.pattern, 'u').test('design:approved:drift'),
  },
  {
    name: 'candidate-only gate-required flag mismatch',
    candidate: bundle({
      records: replaceRecord(bundle().records, 0, value => ({
        ...value,
        gate_outcomes: [{ ...value.gate_outcomes[0], required: false }],
      })),
    }),
    context: trustedContext(),
    expected: 'REJECTED',
    schemaAssertion: schema => /reducer/i.test(schema.$defs.gate_outcome.$comment),
  },
  {
    name: 'missing external trusted context',
    candidate: bundle(),
    context: undefined,
    expected: 'REJECTED',
    schemaAssertion: schema => /external trusted context/i.test(schema.$comment),
  },
]

test('P1 — isolated mutation corpus documents schema shape limits and requires the reducer for trusted-context semantics', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric-evidence.schema.json', import.meta.url), 'utf8'))
  let hasDraft2020Validator = false
  try {
    require.resolve('ajv/dist/2020')
    hasDraft2020Validator = true
  } catch {
    hasDraft2020Validator = false
  }
  if (!hasDraft2020Validator) assert.match(schema.$comment, /shape-only.*reducer.*mandatory/isu)

  for (const specimen of isolatedMutationCorpus()) {
    assert.equal(reduceEvidenceContract(specimen.candidate, specimen.context).status, specimen.expected, specimen.name)
    assert.equal(specimen.schemaAssertion(schema), true, `${specimen.name}: schema declaration`)
  }
})

test('P1 — privacy is field and scheme aware: raw material and unknown held labels reject while durable refs stay opaque', () => {
  const heldCandidate = heldReason => bundle({
    records: replaceRecord(bundle().records, 0, value => ({
      ...value,
      classification: 'HELD',
      held_reasons: [heldReason],
    })),
  })
  for (const heldReason of [
    'operator S-1-5-21-111-222-333-444',
    'operator pid 4321',
    'operator environment: FABRIC_TOKEN',
    'captured browser transcript record',
    'attachment C:\\host\\secret',
    'attachment /root/secret',
    'attachment /srv/fabric/evidence',
    MANIFEST,
    'token: synthetic-secret-value',
    'UNKNOWN_REASON_CODE',
  ]) {
    assert.equal(reduceEvidenceContract(heldCandidate(heldReason), trustedContext()).status, 'REJECTED', heldReason)
  }

  assert.equal(reduceEvidenceContract(heldCandidate('authorization pending independent review'), trustedContext()).status, 'REJECTED')

  for (const ref of ['design:approved:drift', 'design:approved/path', 'design:approved\\path', 'design:s-1-5-21-111-222-333-444']) {
    const candidate = bundle({
      records: replaceRecord(bundle().records, 0, value => ({
        ...value,
        source_refs: [{ ...value.source_refs[0], ref }, ...value.source_refs.slice(1)],
      })),
    })
    assert.equal(reduceEvidenceContract(candidate, trustedContext()).status, 'REJECTED', ref)
  }

  const ordinaryReference = bundle({
    records: replaceRecord(bundle().records, 0, value => ({
      ...value,
      source_refs: [{ ...value.source_refs[0], ref: 'design:authorization_policy' }, ...value.source_refs.slice(1)],
    })),
  })
  assert.equal(reduceEvidenceContract(ordinaryReference, trustedContext()).status, 'HELD')
})

test('evidence reducer produces a stable immutable summary and does not mutate candidate or trusted context', () => {
  const candidate = bundle()
  const context = trustedContext()
  const first = reduceEvidenceContract(candidate, context)
  const second = reduceEvidenceContract(structuredClone(candidate), context)

  assert.equal(first.status, 'HELD')
  assert.equal(first.advisory_eligible, true)
  assert.equal(first.evidence_digest, second.evidence_digest)
  assert.equal(first.trusted_context_digest, second.trusted_context_digest)
  assert.equal(first.acceptance.length, 45)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first.acceptance), true)
  assert.equal(Object.isFrozen(first.acceptance[0]), true)
  assert.deepEqual(candidate, bundle())
  assert.equal(Object.isFrozen(context), true)
  assert.equal(Object.isFrozen(context.acceptance[0]), true)
})

test('P2 RED — candidate and trusted-context digests ignore semantic ordering of AC, gate, source, and required-kind arrays', () => {
  const records = replaceRecord(bundle().records, 0, value => ({
    ...value,
    gate_outcomes: [
      ...value.gate_outcomes,
      gate(value.id, 'POLICY', { gate_id: 'gate:optional_policy', required: false, status: 'failed', terminal: false, current_exact_head: false }),
    ],
  }))
  const candidate = bundle({ records })
  const permutedCandidate = bundle({
    records: [...records].reverse().map(value => ({
      ...value,
      source_refs: [...value.source_refs].reverse(),
      gate_outcomes: [...value.gate_outcomes].reverse(),
      held_reasons: [...value.held_reasons].reverse(),
    })),
  })
  const rawContext = structuredClone(trustedContext())
  rawContext.acceptance = [...rawContext.acceptance].reverse().map(value => ({
    ...value,
    required_gate_kinds: [...value.required_gate_kinds].reverse(),
    required_source_kinds: [...value.required_source_kinds].reverse(),
  }))
  const context = freeze(rawContext)
  const first = reduceEvidenceContract(candidate, trustedContext())
  const second = reduceEvidenceContract(permutedCandidate, context)

  assert.equal(first.status, 'HELD')
  assert.equal(second.status, 'HELD')
  assert.equal(first.evidence_digest, second.evidence_digest)
  assert.equal(first.trusted_context_digest, second.trusted_context_digest)
})

test('evidence schema is closed candidate shape only, binds exact 45 AC IDs, and documents the mandatory external trusted context', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../agent-contracts/parallel-delivery-fabric-evidence.schema.json', import.meta.url), 'utf8'))
  assert.equal(schema.$id, 'parallel-delivery-fabric-evidence.schema.json')
  assert.equal(schema.additionalProperties, false)
  assert.match(schema.$comment, /external trusted context/i)
  assert.match(schema.$comment, /never returns COMPLETE/i)
  assert.equal(schema.properties.records.minItems, 45)
  assert.equal(schema.properties.records.maxItems, 45)
  assert.equal(schema.allOf.length, 45)
  assert.equal(schema.$defs.record.additionalProperties, false)
  assert.equal(schema.$defs.source_ref.additionalProperties, false)
  assert.deepEqual(schema.$defs.source_ref.required, ['kind', 'ref', 'digest'])
  assert.deepEqual(schema.$defs.classification.enum, ['PASSED', 'PARTIAL', 'HELD', 'FAILED', 'NOT_APPLICABLE'])
  assert.deepEqual(schema.$defs.held_reason_code.enum, [
    'PARTIAL_EVIDENCE', 'REQUIRED_GATE_NOT_RUN', 'REQUIRED_GATE_SKIPPED', 'REQUIRED_GATE_NOT_CONFIGURED',
    'HELD_PENDING_EVIDENCE', 'TASK9_EXTERNAL_ACTIVATION_GAP', 'REQUIRED_GATE_NOT_TERMINAL', 'REQUIRED_GATE_NOT_CURRENT_EXACT_HEAD',
    'FAILED_EVIDENCE', 'REQUIRED_GATE_FAILED',
  ])
  assert.equal(schema.$defs.trusted_expected_context.additionalProperties, false)
})
