import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  EVIDENCE_SCHEMA_VERSION,
  TRUSTED_EVIDENCE_CONTEXT_VERSION,
  reduceEvidenceContract,
} from '../../lib/parallel-delivery-fabric-evidence.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const requirementsPath = path.join(repoRoot, 'scripts', 'tests', 'parallel-delivery-fabric', 'acceptance-requirements.json');
const operatorDocPath = path.join(repoRoot, 'docs', 'agents', 'parallel-delivery-fabric.md');
const reducerPath = path.join(repoRoot, 'scripts', 'lib', 'parallel-delivery-fabric-evidence.mjs');

const REQUIREMENTS_VERSION = 'parallel-delivery-fabric-acceptance-requirements/v1';
const OPERATOR_DOC_VERSION = 'parallel-delivery-fabric-operator-policy/v1';
const ACTIVATION_RECORD_FIELDS = [
  'phase',
  'base_sha',
  'policy_digest',
  'writer_cap',
  'external_check_name',
  'external_app_id',
  'activated_at',
];
const REVIEW_PHASES = [
  'LEGACY_GUARDED',
  'SHADOW_DUAL',
  'CUTOVER_ARMED',
  'CANARY_ACTIVE',
  'AUTONOMOUS_ACTIVE',
];
const CHECKRUN_SOURCE_PINS = ['repository', 'app_id', 'check_name', 'base_sha', 'policy_digest'];
const MIGRATION_PREREQUISITES = [
  'settings_lease',
  'rollback_snapshot',
  'post_change_authoritative_reread',
  'add_before_remove',
  'disposable_canary_delivered',
];
const CANARY_CUTOVER_POLICY = Object.freeze({
  from_phase: 'CANARY_ACTIVE',
  to_phase: 'AUTONOMOUS_ACTIVE',
  evidence_scope: 'DISPOSABLE_ONLY',
  authority_state: 'NON_TERMINAL',
  required_prerequisite: 'disposable_canary_delivered',
  legacy_gate_removal: 'AFTER_SUCCESSFUL_CANARY',
});
const DISTINCT_AUTHORITY_ROLES = [
  'machine_check_app',
  'promotion_executor',
  'delivery_executor',
];
// This is intentionally a pinned canonical digest. A map edit is a normative
// contract edit and must update this test and the operator document together.
const EXPECTED_REQUIREMENTS_SHA256 = 'e019c1112015b23f0b43ead124fe6e0fab427bafd0f872266371068f2c7d38df';
const ACCEPTANCE_IDS = Array.from({ length: 45 }, (_, index) => `AC-${String(index + 1).padStart(2, '0')}`);
const REQUIREMENT_KEYS = [
  'activation_requirement',
  'authority_dependencies',
  'evidence_origin',
  'id',
  'required_gate_kinds',
  'semantic',
  'side_effect_class',
  'source_authority',
];
const ROOT_KEYS = [
  'acceptance',
  'activation_migration_prerequisites',
  'canary_cutover_policy',
  'operator_doc_sha256',
  'policy_mode',
  'read_only_effect_denials',
  'schema_version',
  'writer_cap',
];
const GATE_KINDS = new Set(['CONTRACT', 'POLICY', 'STATIC_ANALYSIS', 'PLAYWRIGHT', 'COMPUTER_USE']);
const SOURCE_AUTHORITIES = new Set([
  'APPROVED_DESIGN',
  'LOCAL_CONTRACT_AUTHORITY',
  'PRIOR_BASE_EVIDENCE_AUTHORITY',
  'TASK9_D2_ACTIVATION_AUTHORITY',
  'TASK11B_POST_MERGE_AUTHORITY',
  'AC10_RUNTIME_CAPACITY_AUTHORITY',
  'AC24_RUNTIME_PREFLIGHT_AUTHORITY',
  'EXTERNAL_EXECUTION_CONTEXT_AUTHORITY',
  'EXTERNAL_E2E_VERIFICATION_AUTHORITY',
  'EXTERNAL_PROMOTION_AUTHORITY',
  'HOST_INVENTORY_AUTHORITY',
  'OWNER_END_ATTESTOR',
  'MERGE_QUEUE_OBSERVATION',
  'MANAGED_BRANCH_AUTHORITY',
]);
const EVIDENCE_ORIGINS = new Set(['LOCAL', 'EXTERNAL']);
const SIDE_EFFECT_CLASSES = new Set([
  'NO_SIDE_EFFECT',
  'LOCAL_METADATA_ONLY',
  'EXTERNAL_HANDOFF_ONLY',
  'EXTERNAL_ACTIVATION_REQUIRED',
]);
const ACTIVATION_REQUIREMENTS = new Set([
  'SHADOW_ONLY',
  'PRIOR_BASE_AUTHORITY_REQUIRED',
  'TASK9_D2_AUTHORITY_REQUIRED',
  'TASK11B_POST_MERGE_REQUIRED',
  'EXTERNAL_ACTIVATION_REQUIRED',
]);
const AUTHORITY_DEPENDENCIES = new Set([
  'TASK9_D2_ACTIVATION_AUTHORITY',
  'TASK11B_POST_MERGE_AUTHORITY',
  'AC10_RUNTIME_CAPACITY_AUTHORITY',
  'AC24_RUNTIME_PREFLIGHT_AUTHORITY',
  'EXTERNAL_EXECUTION_CONTEXT_AUTHORITY',
  'EXTERNAL_E2E_VERIFICATION_AUTHORITY',
  'EXTERNAL_PROMOTION_AUTHORITY',
  'HOST_INVENTORY_AUTHORITY',
  'OWNER_END_ATTESTOR',
  'MERGE_QUEUE_OBSERVATION',
  'MANAGED_BRANCH_AUTHORITY',
]);
const READ_ONLY_EFFECT_DENIALS = Object.freeze({
  MERGE_QUEUE_OBSERVATION: ['ENQUEUE', 'MERGE', 'DEPLOY', 'PUBLISH'],
});
const EXPECTED_AUTHORITY_DEPENDENCIES = Object.freeze({
  'AC-01': ['EXTERNAL_EXECUTION_CONTEXT_AUTHORITY'],
  'AC-02': [],
  'AC-03': ['EXTERNAL_EXECUTION_CONTEXT_AUTHORITY'],
  'AC-04': [],
  'AC-05': [],
  'AC-06': [],
  'AC-07': [],
  'AC-08': ['EXTERNAL_EXECUTION_CONTEXT_AUTHORITY'],
  'AC-09': [],
  'AC-10': ['AC10_RUNTIME_CAPACITY_AUTHORITY'],
  'AC-11': ['MANAGED_BRANCH_AUTHORITY'],
  'AC-12': [],
  'AC-13': ['TASK9_D2_ACTIVATION_AUTHORITY'],
  'AC-14': ['TASK9_D2_ACTIVATION_AUTHORITY', 'TASK11B_POST_MERGE_AUTHORITY'],
  'AC-15': ['EXTERNAL_PROMOTION_AUTHORITY'],
  'AC-16': [],
  'AC-17': [],
  'AC-18': [],
  'AC-19': ['EXTERNAL_PROMOTION_AUTHORITY'],
  'AC-20': [],
  'AC-21': [],
  'AC-22': ['EXTERNAL_E2E_VERIFICATION_AUTHORITY'],
  'AC-23': [],
  'AC-24': ['AC24_RUNTIME_PREFLIGHT_AUTHORITY'],
  'AC-25': ['TASK9_D2_ACTIVATION_AUTHORITY'],
  'AC-26': ['EXTERNAL_E2E_VERIFICATION_AUTHORITY'],
  'AC-27': [],
  'AC-28': [],
  'AC-29': [],
  'AC-30': [],
  'AC-31': ['MERGE_QUEUE_OBSERVATION'],
  'AC-32': ['TASK9_D2_ACTIVATION_AUTHORITY', 'EXTERNAL_PROMOTION_AUTHORITY'],
  'AC-33': ['TASK9_D2_ACTIVATION_AUTHORITY', 'TASK11B_POST_MERGE_AUTHORITY'],
  'AC-34': ['TASK9_D2_ACTIVATION_AUTHORITY', 'TASK11B_POST_MERGE_AUTHORITY', 'EXTERNAL_PROMOTION_AUTHORITY'],
  'AC-35': ['TASK9_D2_ACTIVATION_AUTHORITY', 'EXTERNAL_PROMOTION_AUTHORITY'],
  'AC-36': ['TASK11B_POST_MERGE_AUTHORITY'],
  'AC-37': ['EXTERNAL_EXECUTION_CONTEXT_AUTHORITY'],
  'AC-38': ['TASK9_D2_ACTIVATION_AUTHORITY', 'TASK11B_POST_MERGE_AUTHORITY'],
  'AC-39': ['MANAGED_BRANCH_AUTHORITY'],
  'AC-40': ['HOST_INVENTORY_AUTHORITY'],
  'AC-41': ['MERGE_QUEUE_OBSERVATION'],
  'AC-42': ['TASK9_D2_ACTIVATION_AUTHORITY'],
  'AC-43': ['OWNER_END_ATTESTOR'],
  'AC-44': [],
  'AC-45': [],
});
const APPROVED_REDUCER_BUILTIN_IMPORTS = new Set(['node:crypto', 'node:util']);
const APPROVED_REDUCER_LOCAL_PURE_HELPERS = new Set();
const FORGED_SUBJECT_SHA = 'a'.repeat(40);
const FORGED_BASE_SHA = 'b'.repeat(40);
const FORGED_MANIFEST_DIGEST = 'c'.repeat(64);
const FORGED_DESIGN_DIGEST = 'd'.repeat(64);
const FORGED_ACTIVATION_DIGEST = 'e'.repeat(64);
const FORGED_ROLLBACK_DIGEST = 'f'.repeat(64);
const FORGED_GATE_DIGEST = '2'.repeat(64);

function readRequired(filePath) {
  assert.ok(fs.existsSync(filePath), `required Phase B artifact is missing: ${path.relative(repoRoot, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeOperatorDocument(document) {
  const lineNormalized = document.replace(/\r\n?/gu, '\n').replace(/[ \t]+$/gmu, '');
  // The document embeds the map digest, while the map pins this document. Mask
  // only that reciprocal value so both hashes can converge; the test below
  // separately requires the exact live map digest in the document.
  const reciprocalDigestNormalized = lineNormalized.replace(
    /^Requirement map SHA-256: `[0-9a-f]{64}`$/mu,
    'Requirement map SHA-256: `<MAP_POLICY_DIGEST>`',
  );
  return `${reciprocalDigestNormalized.replace(/\n+$/u, '')}\n`;
}

function canaryCutoverPolicySatisfied(policy, transition) {
  return transition?.from_phase === policy.from_phase
    && transition?.to_phase === policy.to_phase
    && transition?.prerequisites?.[policy.required_prerequisite] === true;
}

function reducerImportSpecifiers(source) {
  return [...source.matchAll(/^\s*import\s+(?:[^'"\r\n]*?\s+from\s+)?['"]([^'"\r\n]+)['"]\s*;?\s*$/gmu)]
    .map((match) => match[1]);
}

function assertReducerImportAllowlist(source) {
  assert.doesNotMatch(source, /\b(?:import|require)\s*\(/u, 'the reducer must not use dynamic module loading');
  const imports = reducerImportSpecifiers(source);
  assert.ok(imports.length > 0, 'the reducer must declare its imports explicitly');
  for (const specifier of imports) {
    assert.ok(
      APPROVED_REDUCER_BUILTIN_IMPORTS.has(specifier) || APPROVED_REDUCER_LOCAL_PURE_HELPERS.has(specifier),
      `unapproved reducer import: ${specifier}`,
    );
  }
  assert.deepEqual([...imports].sort(), [...APPROVED_REDUCER_BUILTIN_IMPORTS].sort(),
    'the reducer must keep its exact approved builtin import set');
}

function invokeWithReducerEffectTraps(invoke) {
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const killDescriptor = Object.getOwnPropertyDescriptor(process, 'kill');
  const exitDescriptor = Object.getOwnPropertyDescriptor(process, 'exit');
  for (const [label, descriptor] of [['fetch', fetchDescriptor], ['process.kill', killDescriptor], ['process.exit', exitDescriptor]]) {
    assert.ok(descriptor?.configurable === true, `${label} must be safely restorable for this zero-effect regression`);
  }

  const calls = { fetch: 0, kill: 0, exit: 0 };
  try {
    Object.defineProperty(globalThis, 'fetch', {
      ...fetchDescriptor,
      value: () => {
        calls.fetch += 1;
        throw new Error('unexpected fetch from pure evidence reducer');
      },
    });
    Object.defineProperty(process, 'kill', {
      ...killDescriptor,
      value: () => {
        calls.kill += 1;
        throw new Error('unexpected process.kill from pure evidence reducer');
      },
    });
    Object.defineProperty(process, 'exit', {
      ...exitDescriptor,
      value: () => {
        calls.exit += 1;
        throw new Error('unexpected process.exit from pure evidence reducer');
      },
    });
    return { value: invoke(), calls };
  } finally {
    Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    Object.defineProperty(process, 'kill', killDescriptor);
    Object.defineProperty(process, 'exit', exitDescriptor);
  }
}

function assertClosedArray(value, allowed, label, { allowEmpty = false } = {}) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(allowEmpty || value.length > 0, `${label} must not be empty`);
  assert.equal(new Set(value).size, value.length, `${label} must not repeat values`);
  for (const entry of value) assert.ok(allowed.has(entry), `${label} has an unknown value: ${entry}`);
}

function assertNoCandidateOrSensitiveMaterial(value, location = 'root') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCandidateOrSensitiveMaterial(entry, `${location}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assert.ok(!new Set([
        'candidate', 'candidate_status', 'status', 'result', 'complete', 'passed',
        'live', 'ci', 'manifest_registry', 'secret', 'token', 'cookie',
        'authorization', 'private_key', 'path', 'env', 'sid', 'pid', 'transcript',
      ]).has(key), `${location}.${key} is not allowed in the normative map`);
      assertNoCandidateOrSensitiveMaterial(entry, `${location}.${key}`);
    }
    return;
  }
  if (typeof value === 'string') {
    assert.doesNotMatch(value, /\b(?:PASSED|COMPLETE)\b/u, `${location} must not state a completion result`);
    assert.doesNotMatch(value, /(?:\b(?:candidate|live|secret|token|cookie|authorization|private[_ -]?key|path|env|sid|pid|transcript)\b|[A-Za-z]:[\\/]|\\(?:Users|Windows)\\|\/(?:root|srv|home|tmp)\/)/iu,
      `${location} must not carry sensitive material or a filesystem path`);
  }
}

function byId(requirements, id) {
  const match = requirements.find((entry) => entry.id === id);
  assert.ok(match, `missing ${id}`);
  return match;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function forgedAcceptanceId(number) {
  return `AC-${String(number).padStart(2, '0')}`;
}

function forgedRequiredGateKinds(number) {
  if (number === 22) return ['PLAYWRIGHT'];
  if (number === 26) return ['COMPUTER_USE'];
  return ['CONTRACT'];
}

function forgedSourceRefs(id) {
  return [
    { kind: 'DESIGN', ref: 'design:approved_design', digest: FORGED_DESIGN_DIGEST },
    { kind: 'ACTIVATION', ref: 'activation:task9', digest: FORGED_ACTIVATION_DIGEST },
    { kind: 'ROLLBACK', ref: 'rollback:single_writer', digest: FORGED_ROLLBACK_DIGEST },
    { kind: 'GATE', ref: `gate:evidence_${id.toLowerCase().replace('-', '_')}`, digest: FORGED_GATE_DIGEST },
  ];
}

function forgedGate(id, kind) {
  return {
    gate_id: `gate:${id.toLowerCase().replace('-', '_')}`,
    kind,
    required: true,
    status: 'passed',
    terminal: true,
    current_exact_head: true,
    subject_sha: FORGED_SUBJECT_SHA,
    base_sha: FORGED_BASE_SHA,
    manifest_digest: FORGED_MANIFEST_DIGEST,
    source_ref: `gate:evidence_${id.toLowerCase().replace('-', '_')}`,
    source_digest: FORGED_GATE_DIGEST,
  };
}

function forgedRecord(number) {
  const id = forgedAcceptanceId(number);
  return {
    id,
    classification: 'PASSED',
    subject_sha: FORGED_SUBJECT_SHA,
    base_sha: FORGED_BASE_SHA,
    manifest_digest: FORGED_MANIFEST_DIGEST,
    source_refs: forgedSourceRefs(id),
    gate_outcomes: [forgedGate(id, forgedRequiredGateKinds(number)[0])],
    held_reasons: [],
    activation: { ref: 'activation:task9', digest: FORGED_ACTIVATION_DIGEST, status: 'CURRENT' },
    rollback: { ref: 'rollback:single_writer', digest: FORGED_ROLLBACK_DIGEST },
    applicability: { kind: 'REQUIRED' },
  };
}

function forgedCandidate() {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    records: Array.from({ length: 45 }, (_, index) => forgedRecord(index + 1)),
  };
}

function forgedTrustedContext() {
  return deepFreeze({
    schema_version: TRUSTED_EVIDENCE_CONTEXT_VERSION,
    subject_sha: FORGED_SUBJECT_SHA,
    base_sha: FORGED_BASE_SHA,
    manifest_digest: FORGED_MANIFEST_DIGEST,
    activation: { ref: 'activation:task9', digest: FORGED_ACTIVATION_DIGEST, status: 'CURRENT' },
    rollback: { ref: 'rollback:single_writer', digest: FORGED_ROLLBACK_DIGEST },
    acceptance: Array.from({ length: 45 }, (_, index) => {
      const number = index + 1;
      return {
        id: forgedAcceptanceId(number),
        required_gate_kinds: forgedRequiredGateKinds(number),
        required_source_kinds: ['DESIGN', 'ACTIVATION', 'ROLLBACK', 'GATE'],
        applicability: { kind: 'REQUIRED' },
      };
    }),
  });
}

test('Phase B normative map has exact closed AC-01..45 coverage without candidate outcomes', () => {
  const requirements = JSON.parse(readRequired(requirementsPath));
  assert.deepEqual(Object.keys(requirements).sort(), ROOT_KEYS, 'requirements root keys must be closed');
  assert.equal(requirements.schema_version, REQUIREMENTS_VERSION);
  assert.equal(requirements.policy_mode, 'NORMATIVE_ONLY');
  assert.equal(requirements.writer_cap, 1, 'the descriptive map retains activation-record writer_cap=1 for review/direct_stack, not session count');
  assert.deepEqual(requirements.activation_migration_prerequisites, MIGRATION_PREREQUISITES,
    'the map must retain the closed activation-migration prerequisite vocabulary');
  assert.deepEqual(requirements.canary_cutover_policy, CANARY_CUTOVER_POLICY,
    'the map must retain the closed disposable-canary cutover policy');
  assert.deepEqual(requirements.read_only_effect_denials, READ_ONLY_EFFECT_DENIALS,
    'merge-queue observation must name every forbidden authority effect');
  assertNoCandidateOrSensitiveMaterial(requirements);

  assert.ok(Array.isArray(requirements.acceptance), 'acceptance must be an array');
  assert.equal(requirements.acceptance.length, ACCEPTANCE_IDS.length, 'the map must contain exactly 45 rows');
  assert.deepEqual(requirements.acceptance.map(({ id }) => id), ACCEPTANCE_IDS, 'AC rows must be unique and ordered');
  assert.deepEqual(Object.keys(EXPECTED_AUTHORITY_DEPENDENCIES), ACCEPTANCE_IDS,
    'the expected authority-dependency matrix must cover exactly AC-01..45');

  const semantics = new Set();
  for (const entry of requirements.acceptance) {
    assert.deepEqual(Object.keys(entry).sort(), REQUIREMENT_KEYS, `${entry.id} keys must be closed`);
    assert.match(entry.id, /^AC-(?:0[1-9]|[1-3][0-9]|4[0-5])$/u);
    assert.match(entry.semantic, /^[A-Z0-9_]+$/u, `${entry.id}.semantic must be a closed label`);
    assert.ok(!semantics.has(entry.semantic), `${entry.id}.semantic must be unique`);
    semantics.add(entry.semantic);
    assertClosedArray(entry.required_gate_kinds, GATE_KINDS, `${entry.id}.required_gate_kinds`);
    assertClosedArray(entry.source_authority, SOURCE_AUTHORITIES, `${entry.id}.source_authority`);
    assert.ok(EVIDENCE_ORIGINS.has(entry.evidence_origin), `${entry.id}.evidence_origin must be closed`);
    assert.ok(SIDE_EFFECT_CLASSES.has(entry.side_effect_class), `${entry.id}.side_effect_class must be closed`);
    assert.ok(ACTIVATION_REQUIREMENTS.has(entry.activation_requirement), `${entry.id}.activation_requirement must be closed`);
    assertClosedArray(entry.authority_dependencies, AUTHORITY_DEPENDENCIES, `${entry.id}.authority_dependencies`, { allowEmpty: true });
    assert.deepEqual(entry.authority_dependencies, EXPECTED_AUTHORITY_DEPENDENCIES[entry.id],
      `${entry.id} must retain its exact authority-dependency row`);
    for (const dependency of entry.authority_dependencies) {
      assert.ok(entry.source_authority.includes(dependency), `${entry.id} must name every authority dependency as a source authority`);
    }
  }

  for (const id of ['AC-01', 'AC-03', 'AC-08', 'AC-22']) {
    assert.equal(byId(requirements.acceptance, id).evidence_origin, 'EXTERNAL', `${id} must remain external evidence`);
  }
  assert.deepEqual(byId(requirements.acceptance, 'AC-06').required_gate_kinds, ['CONTRACT', 'STATIC_ANALYSIS'],
    'AC-06 must retain deterministic local scope semantics');
  assert.equal(byId(requirements.acceptance, 'AC-06').semantic, 'SCOPE_NORMALIZATION_AND_CONSERVATIVE_OVERLAP');
  assert.deepEqual(byId(requirements.acceptance, 'AC-09').required_gate_kinds, ['CONTRACT', 'POLICY'],
    'AC-09 must retain pre-write local isolation negatives');
  assert.equal(byId(requirements.acceptance, 'AC-09').semantic, 'PREWRITE_ISOLATION_NEGATIVES');
  assert.ok(byId(requirements.acceptance, 'AC-10').authority_dependencies.includes('AC10_RUNTIME_CAPACITY_AUTHORITY'),
    'AC-10 must name its runtime-capacity authority dependency');
  assert.ok(byId(requirements.acceptance, 'AC-24').authority_dependencies.includes('AC24_RUNTIME_PREFLIGHT_AUTHORITY'),
    'AC-24 must name its runtime-preflight authority dependency');
  assert.ok(byId(requirements.acceptance, 'AC-14').authority_dependencies.includes('TASK9_D2_ACTIVATION_AUTHORITY'),
    'Task 9 D2 authority must be explicit for delivery authority');
  assert.ok(byId(requirements.acceptance, 'AC-34').authority_dependencies.includes('TASK11B_POST_MERGE_AUTHORITY'),
    'Task 11B post-merge authority must be explicit for approval-equivalent review');
  assert.deepEqual(byId(requirements.acceptance, 'AC-01').required_gate_kinds, ['CONTRACT'],
    'AC-01 must not impose unconditional browser gates on non-UI work');
  assert.deepEqual(byId(requirements.acceptance, 'AC-03').required_gate_kinds, ['CONTRACT'],
    'AC-03 must not impose unconditional browser gates on non-UI work');
  assert.deepEqual(byId(requirements.acceptance, 'AC-22').required_gate_kinds, ['PLAYWRIGHT', 'COMPUTER_USE'],
    'AC-22 retains conditional independent Playwright and Computer Use evidence');
  assert.equal(byId(requirements.acceptance, 'AC-22').semantic, 'CONDITIONAL_PER_HEAD_REAL_E2E',
    'AC-22 must make its prior-base applicability condition explicit');
  assert.ok(byId(requirements.acceptance, 'AC-22').source_authority.includes('PRIOR_BASE_EVIDENCE_AUTHORITY'),
    'AC-22 applicability remains prior-base owned');
  for (const id of ['AC-31', 'AC-41']) {
    const row = byId(requirements.acceptance, id);
    assert.equal(row.evidence_origin, 'EXTERNAL', `${id} observes an external merge queue`);
    assert.equal(row.side_effect_class, 'NO_SIDE_EFFECT', `${id} must remain read-only`);
    assert.deepEqual(row.source_authority, ['APPROVED_DESIGN', 'MERGE_QUEUE_OBSERVATION'],
      `${id} must use the read-only queue observation source only`);
  }
  const inventory = byId(requirements.acceptance, 'AC-40');
  assert.deepEqual(inventory.authority_dependencies, ['HOST_INVENTORY_AUTHORITY']);
  const ownerEnd = byId(requirements.acceptance, 'AC-43');
  assert.equal(ownerEnd.evidence_origin, 'EXTERNAL', 'AC-43 is not a local-only release authority');
  assert.equal(ownerEnd.activation_requirement, 'PRIOR_BASE_AUTHORITY_REQUIRED');
  assert.ok(ownerEnd.source_authority.includes('OWNER_END_ATTESTOR'));
  for (const id of ['AC-11', 'AC-39']) {
    const row = byId(requirements.acceptance, id);
    assert.equal(row.activation_requirement, 'PRIOR_BASE_AUTHORITY_REQUIRED',
      `${id} must remain prior-base gated`);
    assert.deepEqual(row.authority_dependencies, ['MANAGED_BRANCH_AUTHORITY'],
      `${id} must retain its managed-branch authority dependency`);
    assert.ok(row.source_authority.includes('MANAGED_BRANCH_AUTHORITY'),
      `${id} must name the managed-branch authority source`);
  }
  assert.ok(byId(requirements.acceptance, 'AC-26').required_gate_kinds.includes('COMPUTER_USE'),
    'AC-26 must retain Computer Use evidence completeness');
});

test('Phase B operator policy and immutable requirement-map digest stay aligned', () => {
  const requirementsText = readRequired(requirementsPath);
  const requirements = JSON.parse(requirementsText);
  const document = readRequired(operatorDocPath);
  const digest = sha256(canonicalJson(requirements));
  const normalizedDocumentDigest = sha256(normalizeOperatorDocument(document));

  assert.equal(digest, EXPECTED_REQUIREMENTS_SHA256,
    'a requirement-map edit must deliberately update this pinned static-policy digest');
  assert.match(requirements.operator_doc_sha256, /^[0-9a-f]{64}$/u,
    'the normative map must carry a machine-readable normalized operator-document digest');
  assert.equal(requirements.operator_doc_sha256, normalizedDocumentDigest,
    'operator policy alignment must bind the whole normalized document, not only selected substrings');
  assert.ok(document.includes('Document version: `' + OPERATOR_DOC_VERSION + '`'));
  assert.ok(document.includes('Requirement map version: `' + REQUIREMENTS_VERSION + '`'));
  assert.ok(document.includes('Requirement map SHA-256: `' + digest + '`'),
    'the reciprocal map digest must still match the current canonical policy map');
  for (const requiredPhrase of [
    'shadow-only',
    'not count-capped',
    'AC-24 HELD',
    'Computer Use',
    'Playwright',
    'safe.directory',
    'ACL',
    'cleanup',
    'Task11B',
    'post-merge Task11B',
    'Node RED',
    'test-admission.mjs:665',
    'QUEUED_FOR_LEASE',
    'HELD_SCOPE_CONFLICT',
    'test-promotion-bridge.mjs:1373',
    'MERGED_NOT_DELIVERED',
    'PREMERGE_EVIDENCE_INVALID',
  ]) {
    assert.ok(document.includes(requiredPhrase), `operator policy must describe ${requiredPhrase}`);
  }
  assert.doesNotMatch(document, /current dirty HEAD.{0,80}\b(?:is|as)\s+(?:a\s+)?(?:pass(?:ed)?|complete)\b/iu,
    'operator policy must not turn the current dirty HEAD into a pass claim');
});

test('P1 operator activation policy pins the exact record tuple, closed phases, and no-authority prerequisites', () => {
  const document = readRequired(operatorDocPath);
  const activationTuple = document.match(/^Activation record tuple: `([^`]+)`$/mu);
  const phaseTuple = document.match(/^Closed one-way phases: `([^`]+)`$/mu);
  const checkRunPins = document.match(/^CheckRun source pins: `([^`]+)`$/mu);
  const migrationPrerequisites = document.match(/^Migration prerequisites: `([^`]+)`$/mu);
  const authorityRoles = document.match(/^Distinct authority roles: `([^`]+)`$/mu);

  assert.ok(activationTuple, 'operator policy must declare one exact activation-record tuple');
  assert.deepEqual(activationTuple[1].split(','), ACTIVATION_RECORD_FIELDS);
  assert.ok(phaseTuple, 'operator policy must declare one closed review-phase sequence');
  assert.deepEqual(phaseTuple[1].split(' -> '), REVIEW_PHASES);
  assert.ok(checkRunPins, 'operator policy must pin the exact CheckRun source tuple');
  assert.deepEqual(checkRunPins[1].split(','), CHECKRUN_SOURCE_PINS);
  assert.ok(migrationPrerequisites, 'operator policy must name the closed migration prerequisites');
  assert.deepEqual(migrationPrerequisites[1].split(','), MIGRATION_PREREQUISITES);
  assert.ok(authorityRoles, 'operator policy must name the closed distinct authority roles');
  assert.deepEqual(authorityRoles[1].split(','), DISTINCT_AUTHORITY_ROLES);
  assert.ok(document.includes('The machine-check App, promotion executor, and delivery executor must not be combined.'),
    'operator policy must prohibit combining the machine check and executor roles');
  assert.ok(document.includes("AC-34 remains indirectly carried by Task11B's source-pinned approval-equivalent check."),
    'operator policy must preserve AC-34 Task11B indirect carriage');
  assert.ok(document.includes('Any missing prerequisite means no authority.'),
    'missing activation evidence must remain non-authoritative');
});

test('P1 activation migration permits autonomous cutover only after a delivered disposable canary', () => {
  const requirements = JSON.parse(readRequired(requirementsPath));
  const document = readRequired(operatorDocPath);
  const policy = requirements.canary_cutover_policy;
  const baselineTransition = {
    from_phase: 'CANARY_ACTIVE',
    to_phase: 'AUTONOMOUS_ACTIVE',
    prerequisites: {},
  };

  assert.deepEqual(requirements.activation_migration_prerequisites, MIGRATION_PREREQUISITES);
  assert.deepEqual(policy, CANARY_CUTOVER_POLICY);
  assert.equal(canaryCutoverPolicySatisfied(policy, baselineTransition), false,
    'a missing disposable canary must not cut over');
  assert.equal(canaryCutoverPolicySatisfied(policy, {
    ...baselineTransition,
    prerequisites: { disposable_canary_delivered: false },
  }), false, 'a false disposable canary must not cut over');
  assert.equal(canaryCutoverPolicySatisfied(policy, {
    ...baselineTransition,
    prerequisites: { disposable_canary_delivered: true },
  }), true, 'only a delivered disposable canary may satisfy the descriptive cutover gate');
  assert.equal(canaryCutoverPolicySatisfied(policy, {
    ...baselineTransition,
    from_phase: 'CUTOVER_ARMED',
    prerequisites: { disposable_canary_delivered: true },
  }), false, 'the successful canary may authorize only its adjacent one-way transition');
  assert.ok(document.includes('CANARY_ACTIVE admits only disposable canary evidence and remains non-terminal; it is not final authority.'),
    'operator policy must keep CANARY_ACTIVE non-terminal and disposable-only');
  assert.ok(document.includes('Only disposable_canary_delivered=true permits the next one-way transition to AUTONOMOUS_ACTIVE and removal of the legacy gate.'),
    'operator policy must forbid legacy-gate removal before a successful disposable canary');
});

test('P2 mutation corpus: normalized document pin detects semantic drift that broad includes would miss', () => {
  const document = readRequired(operatorDocPath);
  const semanticMutation = document.replace('shadow-only', 'shadow-altered');
  assert.notEqual(semanticMutation, document, 'synthetic semantic mutation must change the document');
  assert.ok(semanticMutation.includes('shadow-only') && semanticMutation.includes('not count-capped'),
    'the prior broad includes would still accept this semantic mutation');
  assert.notEqual(sha256(normalizeOperatorDocument(semanticMutation)), sha256(normalizeOperatorDocument(document)),
    'the normalized whole-document digest must reject that semantic mutation');
});

test('Phase B policy source guard supplements the safe-close behavioral regression', () => {
  const reducer = readRequired(reducerPath);
  assertReducerImportAllowlist(reducer);
  assert.match(reducer, /TRUSTED_CONTEXT_AUTHORITY_REQUIRED/u,
    'standalone reducer must name the missing external authority');
  assert.match(reducer, /advisory_eligible/u,
    'standalone reducer may expose advisory eligibility only');
  assert.doesNotMatch(reducer, /status\s*:\s*['"]COMPLETE['"]/u,
    'standalone reducer must have no COMPLETE status path');
  assert.doesNotMatch(reducer, /complete\s*:\s*true\b/u,
    'standalone reducer must have no complete=true path');
});

test('P2 mutation corpus: reducer import allowlist rejects an I/O-capable import fixture', () => {
  assert.throws(
    () => assertReducerImportAllowlist("import { readFileSync } from 'node:fs'\n"),
    /unapproved reducer import: node:fs/u,
  );
});

test('Phase B behavioral regression: a forged all-pass candidate and matching frozen context remain authority-required', () => {
  const candidate = forgedCandidate();
  const trustedContext = forgedTrustedContext();
  assert.equal(Object.isFrozen(trustedContext), true, 'the synthetic trusted context must be deeply frozen');
  assert.equal(Object.isFrozen(trustedContext.acceptance[0]), true, 'nested trusted acceptance rows must be frozen');

  const { value: reducerResults, calls } = invokeWithReducerEffectTraps(() => ({
    advisory: reduceEvidenceContract(candidate, trustedContext),
    missingContext: reduceEvidenceContract(candidate),
    embeddedContext: reduceEvidenceContract({ ...candidate, trusted_context: trustedContext }, trustedContext),
  }));
  assert.deepEqual(calls, { fetch: 0, kill: 0, exit: 0 }, 'pure reducer invocation must not reach any effect trap');

  const { advisory, missingContext, embeddedContext } = reducerResults;
  assert.equal(advisory.status, 'HELD');
  assert.equal(advisory.complete, false);
  assert.equal(advisory.advisory_eligible, true);
  assert.equal(advisory.reason, 'TRUSTED_CONTEXT_AUTHORITY_REQUIRED');
  assert.deepEqual(advisory.blockers, ['TRUSTED_CONTEXT_AUTHORITY_REQUIRED']);

  assert.equal(missingContext.status, 'REJECTED', 'a caller cannot omit the second context argument');
  assert.equal(missingContext.complete, false);
  assert.deepEqual(missingContext.blockers, ['EVIDENCE_CONTRACT_REJECTED']);

  assert.equal(embeddedContext.status, 'REJECTED', 'a candidate cannot embed its own trusted context');
  assert.equal(embeddedContext.complete, false);
  assert.deepEqual(embeddedContext.blockers, ['EVIDENCE_CONTRACT_REJECTED']);
});
