import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const POLICY_VERSION = 'risk-proportional-review-policy/v1';
const INPUT_VERSION = 'review-risk-input/v1';
const DECISION_VERSION = 'review-risk-decision/v1';
const PACKET_VERSION = 'review-packet/v1';
const REVIEW_RESULT_VERSION = 'review-result/v1';
const LOOP_INPUT_VERSION = 'review-loop-input/v1';
const LOOP_DECISION_VERSION = 'review-loop-decision/v1';
const CORPUS_VERSION = 'review-risk-corpus/v1';

const MODE_IDS = ['mechanical_only', 'focused_semantic', 'risk_scoped_specialists', 'human_critical'];
const MODE_SET = new Set(MODE_IDS);
const LANES = new Set(['F', 'B', 'G', 'S']);
const TOPOLOGIES = new Set(['local', 'distributed', 'contractual', 'architectural', 'unknown']);
const DETECTORS = new Set(['ci', 'local', 'qa', 'monitor', 'operator', 'customer', 'none', 'unknown']);
const HORIZONS = new Set(['immediate', 'hours', 'days', 'weeks', 'months', 'unknown']);
const PERSISTENCE = new Set(['none', 'transactional', 'reversible', 'irreversible', 'unknown']);
const ROLLBACKS = new Set(['automatic', 'manual', 'partial', 'none', 'unknown']);
const USERS = new Set(['none', 'bounded', 'many', 'unknown']);
const PATH_STATUSES = new Set(['added', 'modified', 'deleted', 'renamed']);
const EVIDENCE_KINDS = new Set([
  'test_result', 'impact_result', 'contract_result', 'integration_result', 'browser_artifacts',
  'runtime_log', 'security_review', 'mutation_result', 'historical_replay',
]);
const EVIDENCE_STATUSES = new Set(['passed', 'failed', 'missing', 'not_configured', 'not_observed', 'unverified']);
const REGULATED_DATA = new Set(['pii', 'payment', 'health', 'credentials', 'audit', 'customer_model', 'other_regulated']);
const POST_FIX_ACTIONS = new Set([
  'data_cleanup', 'manual_reconciliation', 'user_notification', 'refund', 'regulatory_report',
  'artifact_rebuild', 'index_rebuild', 'none',
]);
const SPECIALISTS = new Set(['security', 'governance', 'architecture', 'data_recovery', 'runtime', 'evidence']);
const LOOP_ACTIONS = new Set(['deterministic_verify', 'evidence_request', 'model_review', 'human_review']);
const LOOP_RESULTS = new Set(['continue', 'advisory_pass', 'advisory_review', 'human_required', 'held', 'blocked']);
const REVIEWER_ROLES = new Set(['focused_semantic', 'security', 'governance', 'architecture', 'data_recovery', 'runtime', 'evidence', 'human']);
const REVIEW_VERDICTS = new Set(['advisory_clear', 'fix_required', 'held', 'unverified']);
const FINDING_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'blocker']);
const FINDING_CATEGORIES = new Set(['correctness', 'security', 'architecture', 'data_recovery', 'runtime', 'evidence']);
const FINDING_STATUSES = new Set(['confirmed', 'unverified', 'refuted']);
const FINDING_DISPOSITIONS = new Set(['fix_now', 'external_blocker', 'known_gap', 'follow_up', 'refuted', 'unverified']);

const POLICY_KEYS = [
  'schema_version', 'authority', 'merge_authority', 'claims_policy', 'identity_binding', 'review_modes',
  'lane_floors', 'packet_budget', 'loop_budget', 'fail_closed_statuses', 'self_referential_floor',
  'required_invariants',
];
const INPUT_KEYS = [
  'schema_version', 'repository', 'base_sha', 'head_sha', 'verification_manifest_sha256', 'lane',
  'changed_paths', 'detection', 'change', 'impact', 'evidence', 'advisory_claims',
];
const REQUIRED_INVARIANTS = [
  'deterministic_checks_before_model_review',
  'existing_lane_may_not_be_downgraded',
  'agent_claims_may_only_escalate',
  'exact_head_evidence_only',
  'missing_evidence_fails_closed',
  'same_evidence_fingerprint_may_not_retry',
  'reviewer_may_not_modify_implementation',
  'adapters_may_not_change_policy_or_verdict_semantics',
  'self_referential_changes_require_existing_base_verification_and_human_approval',
  'shadow_output_is_not_merge_authority',
];

const SELF_REFERENTIAL_PATTERNS = [
  /^\.github\/CODEOWNERS$/,
  /^\.github\/workflows\/(?:agent-governance|pr-review-agent|governance-trust-root|ci)\.ya?ml$/,
  /^scripts\/verification-manifest\.json$/,
  /^scripts\/self-referential-bootstrap-ledger\.json$/,
  /^scripts\/lib\/(?:pr-review-agent|self-referential-bootstrap)\.ps1$/,
  /^scripts\/lib\/verification-(?:plan|runner|outcome|command-policy)\.mjs$/,
  /^scripts\/tests\/(?:test-agent-governance-check|check-pr-body-evidence|test-self-referential-bootstrap|test-base-gate-capability)\.ps1$/,
  /^docs\/agents\/self-referential-bootstrap\.md$/,
  /^agent-contracts\/risk-proportional-review\.contract(?:\.schema)?\.json$/,
  /^scripts\/lib\/risk-proportional-review\.mjs$/,
  /^scripts\/dev\/review-risk-shadow\.mjs$/,
  /^scripts\/tests\/review-risk\.schema\.json$/,
  /^scripts\/tests\/test-review-risk\.mjs$/,
  /^scripts\/tests\/fixtures\/review-risk-[^/]+\.json$/,
  /^docs\/agent-tooling\/hermes-risk-proportional-review\.md$/,
];
const PROTECTED_BOUNDARY_PATTERN = /(^|\/)(?:auth|oauth|sso|security|permissions?|payment|billing|checkout|crypto|encrypt|keys?|audit|compliance|gdpr|secrets?)(?:\/|$|\.)/;
const CONTRACT_PATTERN = /(^|\/)(?:contracts?|schemas?|openapi|events?|protocols?)(?:\/|$|\.)/;
const SHARED_PATTERN = /(^|\/)(?:utils?|common|shared|middleware|core)(?:\/|$|\.)/;
const MIGRATION_PATTERN = /(^|\/)(?:migrations?)(?:\/|$|\.)/;
const RUNTIME_PATTERN = /^(?:bim-streaming-server\/|services\/kit-manager-api\/|infra\/docker\/|compose[^/]*\.ya?ml$|scripts\/(?:deploy|stop-all)\.ps1$)/;
const ARCHITECTURE_PATTERN = /^(?:architecture\/|docs\/architecture\/)/;

function fail(message) {
  throw new Error(`risk-proportional-review: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, required, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} is not recognized`);
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
}

function assertInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function assertString(value, label, { min = 1, max = 512, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max || (pattern && !pattern.test(value))) {
    fail(`${label} is invalid`);
  }
}

function assertUniqueEnumArray(value, allowed, label, { min = 0, max = 16 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must contain ${min}-${max} entries`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates`);
  value.forEach((entry, index) => assertEnum(entry, allowed, `${label}[${index}]`));
}

function assertUniqueStringArray(value, label, { min = 0, max = 16, itemMax = 512 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must contain ${min}-${max} entries`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates`);
  value.forEach((entry, index) => assertString(entry, `${label}[${index}]`, { max: itemMax }));
}

function assertGitSha(value, label) {
  assertString(value, label, { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ });
}

function assertSha256(value, label) {
  assertString(value, label, { pattern: /^[0-9a-f]{64}$/ });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256Value(value) {
  const material = typeof value === 'string' ? value : stableStringify(value);
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export async function readJson(path) {
  const text = await readFile(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

export function normalizeRepositoryPath(value) {
  assertString(value, 'path', { max: 512 });
  let normalized = value.replaceAll('\\', '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) fail(`absolute path is forbidden: ${value}`);
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '')) fail(`path traversal or empty segment is forbidden: ${value}`);
  return normalized;
}

function modeMap(policy) {
  return new Map(policy.review_modes.map((entry) => [entry.id, entry]));
}

function sameSet(actual, expected) {
  return actual.length === expected.length && actual.every((value) => expected.includes(value));
}

export function validatePolicy(candidate) {
  assertExactKeys(candidate, POLICY_KEYS, POLICY_KEYS, 'policy');
  if (candidate.schema_version !== POLICY_VERSION) fail(`unsupported policy schema_version ${candidate.schema_version}`);
  if (candidate.authority !== 'advisory_shadow') fail('policy.authority must be advisory_shadow');
  if (candidate.merge_authority !== false) fail('policy.merge_authority must remain false');
  if (candidate.claims_policy !== 'escalation_only') fail('policy.claims_policy must be escalation_only');
  assertUniqueStringArray(candidate.identity_binding, 'policy.identity_binding', { min: 5, max: 5, itemMax: 64 });
  const expectedIdentity = ['repository', 'base_sha', 'head_sha', 'policy_sha256', 'verification_manifest_sha256'];
  if (!sameSet(candidate.identity_binding, expectedIdentity)) fail('policy.identity_binding must contain the exact immutable identity fields');

  if (!Array.isArray(candidate.review_modes) || candidate.review_modes.length !== MODE_IDS.length) fail('policy.review_modes must contain exactly four modes');
  candidate.review_modes.forEach((entry, index) => {
    assertExactKeys(entry, ['id', 'rank', 'max_model_reviewers', 'human_required'], ['id', 'rank', 'max_model_reviewers', 'human_required'], `policy.review_modes[${index}]`);
    if (entry.id !== MODE_IDS[index] || entry.rank !== index) fail('policy.review_modes must preserve canonical order and ranks');
    assertInteger(entry.max_model_reviewers, `policy.review_modes[${index}].max_model_reviewers`, 0, 2);
    assertBoolean(entry.human_required, `policy.review_modes[${index}].human_required`);
  });
  if (candidate.review_modes[0].max_model_reviewers !== 0 || candidate.review_modes[3].human_required !== true) {
    fail('policy review mode safety floors are invalid');
  }

  assertExactKeys(candidate.lane_floors, ['F', 'B', 'G', 'S'], ['F', 'B', 'G', 'S'], 'policy.lane_floors');
  const expectedFloors = { F: 'mechanical_only', B: 'mechanical_only', G: 'risk_scoped_specialists', S: 'risk_scoped_specialists' };
  for (const lane of LANES) {
    if (candidate.lane_floors[lane] !== expectedFloors[lane]) fail(`policy.lane_floors.${lane} violates the existing lane floor`);
  }

  assertExactKeys(candidate.packet_budget, ['max_bytes', 'max_changed_paths', 'max_evidence_refs', 'max_questions'], ['max_bytes', 'max_changed_paths', 'max_evidence_refs', 'max_questions'], 'policy.packet_budget');
  assertInteger(candidate.packet_budget.max_bytes, 'policy.packet_budget.max_bytes', 4096, 65536);
  assertInteger(candidate.packet_budget.max_changed_paths, 'policy.packet_budget.max_changed_paths', 1, 64);
  assertInteger(candidate.packet_budget.max_evidence_refs, 'policy.packet_budget.max_evidence_refs', 1, 32);
  assertInteger(candidate.packet_budget.max_questions, 'policy.packet_budget.max_questions', 1, 8);

  assertExactKeys(candidate.loop_budget, ['max_attempts', 'max_evidence_delta_requests', 'required_check_retries'], ['max_attempts', 'max_evidence_delta_requests', 'required_check_retries'], 'policy.loop_budget');
  if (candidate.loop_budget.max_attempts !== 2 || candidate.loop_budget.max_evidence_delta_requests !== 1 || candidate.loop_budget.required_check_retries !== 0) {
    fail('policy.loop_budget must preserve bounded-loop safety values');
  }

  assertUniqueStringArray(candidate.fail_closed_statuses, 'policy.fail_closed_statuses', { min: 5, max: 5, itemMax: 32 });
  if (!sameSet(candidate.fail_closed_statuses, ['missing', 'not_configured', 'not_observed', 'unverified', 'stale'])) {
    fail('policy.fail_closed_statuses must preserve the exact fail-closed statuses');
  }
  if (candidate.self_referential_floor !== 'human_critical') fail('policy.self_referential_floor must be human_critical');
  assertUniqueStringArray(candidate.required_invariants, 'policy.required_invariants', { min: 10, max: 10, itemMax: 128 });
  if (!sameSet(candidate.required_invariants, REQUIRED_INVARIANTS)) fail('policy.required_invariants is incomplete');
  return candidate;
}

function validateChangedPath(entry, index) {
  const label = `input.changed_paths[${index}]`;
  assertExactKeys(entry, ['path', 'status', 'additions', 'deletions'], ['path', 'status', 'additions', 'deletions'], label);
  entry.path = normalizeRepositoryPath(entry.path);
  assertEnum(entry.status, PATH_STATUSES, `${label}.status`);
  assertInteger(entry.additions, `${label}.additions`, 0, 1_000_000);
  assertInteger(entry.deletions, `${label}.deletions`, 0, 1_000_000);
}

function validateEvidence(entry, index) {
  const label = `input.evidence[${index}]`;
  assertExactKeys(entry, ['kind', 'status', 'ref', 'head_sha'], ['kind', 'status', 'ref', 'head_sha'], label);
  assertEnum(entry.kind, EVIDENCE_KINDS, `${label}.kind`);
  assertEnum(entry.status, EVIDENCE_STATUSES, `${label}.status`);
  assertString(entry.ref, `${label}.ref`, { max: 512 });
  assertGitSha(entry.head_sha, `${label}.head_sha`);
}

export function validateInput(candidate) {
  const input = cloneJson(candidate);
  assertExactKeys(input, INPUT_KEYS, INPUT_KEYS, 'input');
  if (input.schema_version !== INPUT_VERSION) fail(`unsupported input schema_version ${input.schema_version}`);
  assertString(input.repository, 'input.repository', { max: 200, pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ });
  assertGitSha(input.base_sha, 'input.base_sha');
  assertGitSha(input.head_sha, 'input.head_sha');
  if (input.base_sha === input.head_sha) fail('input.base_sha and input.head_sha must differ');
  assertSha256(input.verification_manifest_sha256, 'input.verification_manifest_sha256');
  assertEnum(input.lane, LANES, 'input.lane');

  if (!Array.isArray(input.changed_paths) || input.changed_paths.length < 1 || input.changed_paths.length > 1000) {
    fail('input.changed_paths must contain 1-1000 entries');
  }
  input.changed_paths.forEach(validateChangedPath);
  const normalizedPaths = input.changed_paths.map((entry) => entry.path);
  if (new Set(normalizedPaths).size !== normalizedPaths.length) fail('input.changed_paths must not contain duplicate normalized paths');

  assertExactKeys(input.detection, ['detector', 'observed', 'horizon'], ['detector', 'observed', 'horizon'], 'input.detection');
  assertEnum(input.detection.detector, DETECTORS, 'input.detection.detector');
  assertBoolean(input.detection.observed, 'input.detection.observed');
  assertEnum(input.detection.horizon, HORIZONS, 'input.detection.horizon');

  const changeKeys = [
    'persistent_write', 'rollback', 'external_side_effects', 'regulated_data', 'post_fix_actions',
    'runtime_or_deploy', 'public_contract_changed', 'architecture_authority_changed',
    'duplicated_rule_risk', 'self_referential',
  ];
  assertExactKeys(input.change, changeKeys, changeKeys, 'input.change');
  assertEnum(input.change.persistent_write, PERSISTENCE, 'input.change.persistent_write');
  assertEnum(input.change.rollback, ROLLBACKS, 'input.change.rollback');
  assertBoolean(input.change.external_side_effects, 'input.change.external_side_effects');
  assertUniqueEnumArray(input.change.regulated_data, REGULATED_DATA, 'input.change.regulated_data', { max: 8 });
  assertUniqueEnumArray(input.change.post_fix_actions, POST_FIX_ACTIONS, 'input.change.post_fix_actions', { max: 8 });
  if (input.change.post_fix_actions.includes('none') && input.change.post_fix_actions.length > 1) {
    fail('input.change.post_fix_actions cannot combine none with real actions');
  }
  for (const field of ['runtime_or_deploy', 'public_contract_changed', 'architecture_authority_changed', 'duplicated_rule_risk', 'self_referential']) {
    assertBoolean(input.change[field], `input.change.${field}`);
  }

  assertExactKeys(input.impact, ['topology', 'affected_services', 'callers', 'users'], ['topology', 'affected_services', 'callers', 'users'], 'input.impact');
  assertEnum(input.impact.topology, TOPOLOGIES, 'input.impact.topology');
  if (input.impact.affected_services !== null) assertInteger(input.impact.affected_services, 'input.impact.affected_services', 0, 10_000);
  if (input.impact.callers !== null) assertInteger(input.impact.callers, 'input.impact.callers', 0, 1_000_000);
  assertEnum(input.impact.users, USERS, 'input.impact.users');

  if (!Array.isArray(input.evidence) || input.evidence.length > 128) fail('input.evidence must contain at most 128 entries');
  input.evidence.forEach(validateEvidence);
  const evidenceIds = input.evidence.map((entry) => `${entry.kind}\0${entry.ref}\0${entry.head_sha}`);
  if (new Set(evidenceIds).size !== evidenceIds.length) fail('input.evidence contains duplicate kind/ref/head entries');

  if (input.advisory_claims !== null) {
    assertExactKeys(input.advisory_claims, ['q1', 'q2', 'q3', 'summary'], ['q1', 'q2', 'q3', 'summary'], 'input.advisory_claims');
    for (const q of ['q1', 'q2', 'q3']) assertInteger(input.advisory_claims[q], `input.advisory_claims.${q}`, 1, 5);
    if (typeof input.advisory_claims.summary !== 'string' || input.advisory_claims.summary.length > 512) fail('input.advisory_claims.summary is invalid');
  }
  return input;
}

function pathFacts(paths) {
  const result = {
    selfReferential: false,
    protectedBoundary: false,
    contract: false,
    shared: false,
    migration: false,
    runtime: false,
    architecture: false,
    envOrSecret: false,
    signals: new Set(),
  };
  for (const { path } of paths) {
    if (SELF_REFERENTIAL_PATTERNS.some((pattern) => pattern.test(path))) {
      result.selfReferential = true;
      result.signals.add(`self_referential_path:${path}`);
    }
    if (PROTECTED_BOUNDARY_PATTERN.test(path)) {
      result.protectedBoundary = true;
      result.signals.add(`protected_boundary_path:${path}`);
    }
    if (CONTRACT_PATTERN.test(path) || path.startsWith('agent-contracts/') || /task-packet/.test(path)) {
      result.contract = true;
      result.signals.add(`contract_path:${path}`);
    }
    if (SHARED_PATTERN.test(path)) {
      result.shared = true;
      result.signals.add(`shared_path:${path}`);
    }
    if (MIGRATION_PATTERN.test(path)) {
      result.migration = true;
      result.signals.add(`migration_path:${path}`);
    }
    if (RUNTIME_PATTERN.test(path)) {
      result.runtime = true;
      result.signals.add(`runtime_path:${path}`);
    }
    if (ARCHITECTURE_PATTERN.test(path)) {
      result.architecture = true;
      result.signals.add(`architecture_path:${path}`);
    }
    if (/(^|\/)\.env(?:\.|$)|(^|\/)(?:secrets?|credentials?)(?:\/|$|\.)/.test(path)) {
      result.envOrSecret = true;
      result.signals.add(`secret_or_env_path:${path}`);
    }
  }
  return result;
}

const TOPOLOGY_RANK = new Map([['local', 0], ['distributed', 1], ['contractual', 2], ['architectural', 3], ['unknown', -1]]);

function maxTopology(current, candidate) {
  if (current === 'unknown') return candidate;
  if (candidate === 'unknown') return current;
  return TOPOLOGY_RANK.get(candidate) > TOPOLOGY_RANK.get(current) ? candidate : current;
}

function deriveTopology(input, paths, signals) {
  let topology = input.impact.topology;
  if (input.change.self_referential || paths.selfReferential || input.change.architecture_authority_changed || paths.architecture) {
    topology = maxTopology(topology, 'architectural');
  }
  if (input.change.public_contract_changed || paths.contract || paths.migration) topology = maxTopology(topology, 'contractual');
  if (
    input.change.duplicated_rule_risk || paths.shared ||
    (input.impact.affected_services !== null && input.impact.affected_services >= 2) ||
    (input.impact.callers !== null && input.impact.callers >= 3)
  ) {
    topology = maxTopology(topology, 'distributed');
  }
  if (topology === 'unknown') signals.add('topology_unknown');
  else signals.add(`topology:${topology}`);
  return topology;
}

function deriveTrustSurface(input, paths, signals) {
  if (input.change.self_referential || paths.selfReferential || input.change.architecture_authority_changed) {
    signals.add('critical_authority_surface');
    return 'critical_authority';
  }
  if (paths.protectedBoundary || paths.envOrSecret || input.change.regulated_data.length > 0) {
    signals.add('protected_boundary_surface');
    return 'protected_boundary';
  }
  return 'normal';
}

function deriveConsequence(input, paths, signals) {
  const postFix = new Set(input.change.post_fix_actions.filter((entry) => entry !== 'none'));
  const writes = input.change.persistent_write;
  const noCleanRollback = writes !== 'none' && ['none', 'unknown', 'partial'].includes(input.change.rollback);
  const regulatory = input.change.regulated_data.length > 0 || postFix.has('regulatory_report');
  const hardCritical =
    regulatory || paths.protectedBoundary || paths.envOrSecret || paths.migration ||
    writes === 'irreversible' || noCleanRollback || postFix.has('refund');

  if (hardCritical) {
    if (regulatory) signals.add('regulated_or_legal_consequence');
    if (writes === 'irreversible') signals.add('irreversible_persistent_write');
    if (noCleanRollback) signals.add('persistent_write_without_clean_rollback');
    if (postFix.size > 0) signals.add(`post_fix_actions:${[...postFix].sort().join(',')}`);
    return 'critical';
  }

  const high =
    writes === 'unknown' ||
    ((writes === 'transactional' || writes === 'reversible') && postFix.size > 0) ||
    input.change.external_side_effects ||
    input.impact.users === 'many' ||
    (input.impact.affected_services !== null && input.impact.affected_services >= 3) ||
    postFix.has('data_cleanup') || postFix.has('manual_reconciliation') || postFix.has('user_notification');
  if (high) {
    signals.add('high_recovery_or_blast_radius');
    return 'high';
  }

  const medium =
    writes === 'transactional' || writes === 'reversible' ||
    input.impact.users === 'bounded' ||
    (input.impact.affected_services !== null && input.impact.affected_services >= 2) ||
    input.change.public_contract_changed || input.change.runtime_or_deploy || paths.runtime;
  if (medium) {
    signals.add('bounded_but_nontrivial_consequence');
    return 'medium';
  }
  return 'low';
}

function requiredEvidenceKinds(input, topology, trustSurface, paths) {
  const kinds = new Set(['test_result']);
  if (input.lane === 'G' || input.lane === 'S') {
    kinds.add('impact_result');
    kinds.add('integration_result');
  }
  if (topology === 'distributed') {
    kinds.add('impact_result');
    kinds.add('integration_result');
  }
  if (topology === 'contractual') {
    kinds.add('contract_result');
    kinds.add('integration_result');
  }
  if (topology === 'architectural') {
    kinds.add('impact_result');
    kinds.add('contract_result');
    kinds.add('integration_result');
  }
  if (input.change.runtime_or_deploy || paths.runtime) kinds.add('runtime_log');
  if (trustSurface !== 'normal') kinds.add('security_review');
  if (input.change.duplicated_rule_risk) kinds.add('impact_result');
  return [...kinds].sort();
}

function evaluateEvidence(input, requiredKinds, signals) {
  const gaps = [];
  let exactFailed = false;
  let exactPassedCount = 0;
  let staleRequired = false;
  for (const kind of requiredKinds) {
    const items = input.evidence.filter((entry) => entry.kind === kind);
    const exactItems = items.filter((entry) => entry.head_sha === input.head_sha);
    const failed = exactItems.find((entry) => entry.status === 'failed');
    if (failed) {
      exactFailed = true;
      gaps.push(`${kind}:failed:${failed.ref}`);
      continue;
    }
    if (exactItems.some((entry) => entry.status === 'passed')) {
      exactPassedCount += 1;
      continue;
    }
    if (items.some((entry) => entry.status === 'passed' && entry.head_sha !== input.head_sha)) {
      staleRequired = true;
      gaps.push(`${kind}:stale_for_head`);
      continue;
    }
    const failClosed = exactItems.find((entry) => entry.status !== 'passed');
    gaps.push(`${kind}:${failClosed?.status ?? 'missing'}`);
  }
  let strength;
  if (exactFailed) strength = 'failed';
  else if (exactPassedCount === requiredKinds.length) strength = 'strong';
  else if (staleRequired) strength = 'stale';
  else if (exactPassedCount === 0) strength = 'missing';
  else strength = 'partial';
  signals.add(`evidence_strength:${strength}`);
  return { strength, gaps, exactFailed };
}

function deriveDetectability(input, evidenceStrength, signals) {
  let value = 'unknown';
  if (!input.detection.observed || input.detection.detector === 'unknown') value = 'unknown';
  else if (['customer', 'none'].includes(input.detection.detector)) value = 'weak';
  else if (['qa', 'monitor', 'operator'].includes(input.detection.detector)) value = 'moderate';
  else if (['ci', 'local'].includes(input.detection.detector) && evidenceStrength === 'strong') value = 'strong';
  else value = 'unknown';
  signals.add(`detectability:${value}`);
  return value;
}

function modeRank(policy, mode) {
  const entry = modeMap(policy).get(mode);
  if (!entry) fail(`unknown review mode ${mode}`);
  return entry.rank;
}

function raiseMode(policy, current, candidate) {
  return modeRank(policy, candidate) > modeRank(policy, current) ? candidate : current;
}

function claimMode(claims) {
  if (claims === null) return null;
  const scores = [claims.q1, claims.q2, claims.q3];
  const total = scores.reduce((sum, value) => sum + value, 0);
  if (scores.includes(5) || total >= 12) return 'human_critical';
  if (total >= 9 || claims.q3 >= 4) return 'risk_scoped_specialists';
  if (total >= 6) return 'focused_semantic';
  return 'mechanical_only';
}

function chooseReviewMode(input, policy, risk, evidence, signals) {
  let mode = policy.lane_floors[input.lane];
  const initial = mode;
  if (risk.trust_surface === 'critical_authority' || risk.topology === 'architectural' || risk.consequence === 'critical') {
    mode = raiseMode(policy, mode, 'human_critical');
  } else if (
    ['distributed', 'contractual'].includes(risk.topology) || risk.consequence === 'high' ||
    ['weeks', 'months'].includes(risk.horizon) || risk.detectability === 'weak' || input.change.duplicated_rule_risk
  ) {
    mode = raiseMode(policy, mode, 'risk_scoped_specialists');
  } else if (
    risk.topology === 'unknown' || risk.consequence === 'medium' || risk.detectability !== 'strong' ||
    !['immediate', 'hours'].includes(risk.horizon) || evidence.strength !== 'strong'
  ) {
    mode = raiseMode(policy, mode, 'focused_semantic');
  }

  if (input.lane === 'G' || input.lane === 'S') mode = raiseMode(policy, mode, 'risk_scoped_specialists');
  const claimed = claimMode(input.advisory_claims);
  let advisoryClaimEscalation = false;
  if (claimed && modeRank(policy, claimed) > modeRank(policy, mode)) {
    mode = claimed;
    advisoryClaimEscalation = true;
    signals.add(`advisory_claim_escalated_to:${claimed}`);
  }
  if (modeRank(policy, mode) < modeRank(policy, initial)) fail('review mode attempted to downgrade the lane floor');
  return { mode, advisoryClaimEscalation };
}

function selectSpecialists(input, policy, mode, risk, paths, evidenceGaps) {
  const candidates = [];
  const add = (value) => { if (!candidates.includes(value)) candidates.push(value); };
  if (risk.trust_surface === 'critical_authority') add('governance');
  if (risk.trust_surface === 'protected_boundary' || input.change.regulated_data.length > 0 || paths.protectedBoundary || paths.envOrSecret) add('security');
  if (['distributed', 'contractual', 'architectural'].includes(risk.topology) || input.change.duplicated_rule_risk) add('architecture');
  if (input.change.persistent_write !== 'none' || input.change.post_fix_actions.some((entry) => entry !== 'none')) add('data_recovery');
  if (input.change.runtime_or_deploy || paths.runtime) add('runtime');
  if (evidenceGaps.length > 0) add('evidence');
  const budget = modeMap(policy).get(mode).max_model_reviewers;
  return candidates.filter((entry) => SPECIALISTS.has(entry)).slice(0, budget);
}

function buildQuestions(input, mode, risk, evidenceGaps, paths, maxQuestions) {
  if (mode === 'mechanical_only') return [];
  const questions = [];
  const add = (value) => { if (!questions.includes(value) && questions.length < maxQuestions) questions.push(value); };
  if (risk.trust_surface === 'critical_authority') add('Does the existing base-owned mechanism independently verify this self-referential change, and is explicit human approval recorded?');
  if (risk.trust_surface === 'protected_boundary') add('What concrete authorization, secret, regulated-data, and abuse-path invariants can this change violate?');
  if (risk.topology === 'architectural') add('Does this change move service ownership, trust boundaries, control-plane authority, or execution-plane authority?');
  if (risk.topology === 'contractual') add('Are backward compatibility, versioning, producer/consumer parity, and rollback behavior proven for the changed contract?');
  if (risk.topology === 'distributed' || input.change.duplicated_rule_risk || paths.shared) add('Is one business rule now duplicated or inconsistently owned across callers, services, or adapters?');
  if (input.change.persistent_write !== 'none') add('If the defect runs for 30 days, what persisted state remains after the code fix and how is it reconciled?');
  if (input.change.runtime_or_deploy || paths.runtime) add('Which runtime observation proves the intended process, endpoint, stage, or deployment authority actually changed?');
  for (const gap of evidenceGaps) add(`Supply exact-head evidence for ${gap}.`);
  if (questions.length === 0) add('Which semantic invariant is not already proven by deterministic exact-head evidence?');
  return questions;
}

function decideVerdict(mode, evidence) {
  if (evidence.exactFailed) return 'blocked';
  if (mode === 'human_critical') return 'human_required';
  if (evidence.strength !== 'strong') return 'held';
  if (mode === 'mechanical_only') return 'advisory_pass';
  return 'advisory_review';
}

function buildReasons(input, risk, mode, evidence, paths) {
  const reasons = [];
  const add = (value) => { if (!reasons.includes(value)) reasons.push(value); };
  add(`lane_${input.lane}_floor_preserved`);
  add(`review_mode_${mode}`);
  if (risk.topology !== 'local') add(`change_topology_${risk.topology}`);
  if (risk.consequence !== 'low') add(`consequence_${risk.consequence}`);
  if (risk.detectability !== 'strong') add(`detectability_${risk.detectability}`);
  if (!['immediate', 'hours'].includes(risk.horizon)) add(`detection_horizon_${risk.horizon}`);
  if (evidence.strength !== 'strong') add(`exact_head_evidence_${evidence.strength}`);
  if (risk.trust_surface !== 'normal') add(`trust_surface_${risk.trust_surface}`);
  if (input.change.duplicated_rule_risk) add('structural_duplication_requires_semantic_review');
  if (paths.runtime || input.change.runtime_or_deploy) add('runtime_truth_requires_observation');
  return reasons.slice(0, 16);
}

export function classifyReview(candidateInput, candidatePolicy) {
  const policy = validatePolicy(cloneJson(candidatePolicy));
  const input = validateInput(candidateInput);
  const signals = new Set();
  const paths = pathFacts(input.changed_paths);
  for (const signal of paths.signals) signals.add(signal);
  if (input.change.self_referential) signals.add('declared_self_referential');
  if (input.change.public_contract_changed) signals.add('declared_public_contract_change');
  if (input.change.architecture_authority_changed) signals.add('declared_architecture_authority_change');
  if (input.change.duplicated_rule_risk) signals.add('declared_duplicated_rule_risk');
  if (input.change.runtime_or_deploy) signals.add('declared_runtime_or_deploy');

  const topology = deriveTopology(input, paths, signals);
  const trustSurface = deriveTrustSurface(input, paths, signals);
  const consequence = deriveConsequence(input, paths, signals);
  const requiredEvidence = requiredEvidenceKinds(input, topology, trustSurface, paths);
  const evidence = evaluateEvidence(input, requiredEvidence, signals);
  const detectability = deriveDetectability(input, evidence.strength, signals);
  const risk = {
    detectability,
    horizon: input.detection.horizon,
    consequence,
    topology,
    evidence_strength: evidence.strength,
    trust_surface: trustSurface,
  };
  const { mode, advisoryClaimEscalation } = chooseReviewMode(input, policy, risk, evidence, signals);
  const specialists = selectSpecialists(input, policy, mode, risk, paths, evidence.gaps);
  const questions = buildQuestions(input, mode, risk, evidence.gaps, paths, policy.packet_budget.max_questions);
  const verdict = decideVerdict(mode, evidence);
  const decision = {
    schema_version: DECISION_VERSION,
    authority: policy.authority,
    merge_authority: false,
    repository: input.repository,
    base_sha: input.base_sha,
    head_sha: input.head_sha,
    policy_sha256: sha256Value(policy),
    input_sha256: sha256Value(input),
    verification_manifest_sha256: input.verification_manifest_sha256,
    lane: input.lane,
    risk,
    review_mode: mode,
    model_reviewer_budget: modeMap(policy).get(mode).max_model_reviewers,
    specialists,
    questions,
    required_evidence: requiredEvidence,
    evidence_gaps: evidence.gaps,
    signals: [...signals].sort().slice(0, 32),
    advisory_claim_escalation: advisoryClaimEscalation,
    verdict,
    reasons: buildReasons(input, risk, mode, evidence, paths),
  };
  return decision;
}

function pathPriority(entry) {
  const facts = pathFacts([entry]);
  if (facts.selfReferential) return 0;
  if (facts.protectedBoundary || facts.envOrSecret) return 1;
  if (facts.contract || facts.migration) return 2;
  if (facts.runtime || facts.architecture) return 3;
  if (facts.shared) return 4;
  return 5;
}

function packetHashMaterial(packet) {
  const material = cloneJson(packet);
  delete material.packet_sha256;
  return material;
}

function computePacketBytes(packetWithoutHash) {
  return Buffer.byteLength(stableStringify(packetWithoutHash), 'utf8');
}

function refreshPacketActualBytes(packet) {
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const next = computePacketBytes(packetHashMaterial(packet));
    if (next === packet.budget.actual_bytes) return next;
    packet.budget.actual_bytes = next;
  }
  fail('packet byte accounting did not converge');
}

export function buildReviewPacket(candidateInput, decision, candidatePolicy) {
  const policy = validatePolicy(cloneJson(candidatePolicy));
  const input = validateInput(candidateInput);
  if (decision.schema_version !== DECISION_VERSION || decision.input_sha256 !== sha256Value(input)) {
    fail('decision is not bound to the supplied input');
  }
  if (decision.policy_sha256 !== sha256Value(policy) || decision.head_sha !== input.head_sha) {
    fail('decision identity does not match the policy or exact head');
  }
  const expectedDecision = classifyReview(input, policy);
  if (stableStringify(decision) !== stableStringify(expectedDecision)) {
    fail('decision does not match deterministic classification for the supplied input and policy');
  }

  const budgetPolicy = policy.packet_budget;
  const selectedPaths = [...input.changed_paths]
    .sort((a, b) => pathPriority(a) - pathPriority(b) || a.path.localeCompare(b.path))
    .slice(0, budgetPolicy.max_changed_paths);
  const prioritizedEvidence = [...input.evidence]
    .sort((a, b) => {
      const aRequired = decision.required_evidence.includes(a.kind) ? 0 : 1;
      const bRequired = decision.required_evidence.includes(b.kind) ? 0 : 1;
      const aExact = a.head_sha === input.head_sha ? 0 : 1;
      const bExact = b.head_sha === input.head_sha ? 0 : 1;
      const aPassed = a.status === 'passed' ? 0 : 1;
      const bPassed = b.status === 'passed' ? 0 : 1;
      return aRequired - bRequired || aExact - bExact || aPassed - bPassed || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref);
    });
  const selectedEvidence = [];
  const selectedEvidenceRefs = new Set();
  for (const entry of prioritizedEvidence) {
    if (selectedEvidenceRefs.has(entry.ref)) continue;
    selectedEvidence.push(entry);
    selectedEvidenceRefs.add(entry.ref);
    if (selectedEvidence.length >= budgetPolicy.max_evidence_refs) break;
  }
  const selectedQuestions = decision.questions.slice(0, budgetPolicy.max_questions);
  const exceeded = [];
  if (input.changed_paths.length > budgetPolicy.max_changed_paths) exceeded.push('changed_paths');
  if (input.evidence.length > budgetPolicy.max_evidence_refs) exceeded.push('evidence_refs');
  if (decision.questions.length > budgetPolicy.max_questions) exceeded.push('questions');

  const packet = {
    schema_version: PACKET_VERSION,
    authority: 'advisory_shadow',
    merge_authority: false,
    repository: input.repository,
    base_sha: input.base_sha,
    head_sha: input.head_sha,
    policy_sha256: decision.policy_sha256,
    input_sha256: decision.input_sha256,
    verification_manifest_sha256: input.verification_manifest_sha256,
    status: 'ready',
    review_mode: decision.review_mode,
    specialists: decision.specialists,
    selected_paths: selectedPaths,
    omitted_path_count: input.changed_paths.length - selectedPaths.length,
    risk: decision.risk,
    evidence_refs: selectedEvidence,
    evidence_gaps: decision.evidence_gaps,
    questions: selectedQuestions,
    budget: {
      max_bytes: budgetPolicy.max_bytes,
      actual_bytes: 0,
      max_changed_paths: budgetPolicy.max_changed_paths,
      selected_changed_paths: selectedPaths.length,
      max_evidence_refs: budgetPolicy.max_evidence_refs,
      selected_evidence_refs: selectedEvidence.length,
      max_questions: budgetPolicy.max_questions,
      selected_questions: selectedQuestions.length,
      exceeded,
    },
    packet_sha256: '',
  };

  if (['held', 'blocked'].includes(decision.verdict)) packet.status = 'held';
  packet.budget.exceeded = [...new Set(packet.budget.exceeded)].sort();
  if (packet.budget.exceeded.length > 0) packet.status = 'budget_exceeded';
  refreshPacketActualBytes(packet);
  if (packet.budget.actual_bytes > budgetPolicy.max_bytes && !packet.budget.exceeded.includes('bytes')) {
    packet.budget.exceeded.push('bytes');
    packet.budget.exceeded.sort();
    packet.status = 'budget_exceeded';
    refreshPacketActualBytes(packet);
  }
  packet.packet_sha256 = sha256Value(packetHashMaterial(packet));
  return packet;
}

export function validateReviewPacket(candidate) {
  const packet = cloneJson(candidate);
  const keys = [
    'schema_version', 'authority', 'merge_authority', 'repository', 'base_sha', 'head_sha', 'policy_sha256',
    'input_sha256', 'verification_manifest_sha256', 'status', 'review_mode', 'specialists', 'selected_paths',
    'omitted_path_count', 'risk', 'evidence_refs', 'evidence_gaps', 'questions', 'budget', 'packet_sha256',
  ];
  assertExactKeys(packet, keys, keys, 'packet');
  if (packet.schema_version !== PACKET_VERSION) fail(`unsupported packet schema_version ${packet.schema_version}`);
  if (packet.authority !== 'advisory_shadow' || packet.merge_authority !== false) fail('packet must remain advisory-only');
  assertString(packet.repository, 'packet.repository', { max: 200, pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/ });
  assertGitSha(packet.base_sha, 'packet.base_sha');
  assertGitSha(packet.head_sha, 'packet.head_sha');
  assertSha256(packet.policy_sha256, 'packet.policy_sha256');
  assertSha256(packet.input_sha256, 'packet.input_sha256');
  assertSha256(packet.verification_manifest_sha256, 'packet.verification_manifest_sha256');
  assertEnum(packet.review_mode, MODE_SET, 'packet.review_mode');
  if (!['ready', 'budget_exceeded', 'held'].includes(packet.status)) fail('packet.status is not recognized');
  assertUniqueEnumArray(packet.specialists, SPECIALISTS, 'packet.specialists', { max: 2 });

  if (!Array.isArray(packet.selected_paths) || packet.selected_paths.length > 24) fail('packet.selected_paths must contain at most 24 entries');
  packet.selected_paths.forEach((entry, index) => {
    const label = `packet.selected_paths[${index}]`;
    assertExactKeys(entry, ['path', 'status', 'additions', 'deletions'], ['path', 'status', 'additions', 'deletions'], label);
    entry.path = normalizeRepositoryPath(entry.path);
    assertEnum(entry.status, PATH_STATUSES, `${label}.status`);
    assertInteger(entry.additions, `${label}.additions`, 0, 1_000_000);
    assertInteger(entry.deletions, `${label}.deletions`, 0, 1_000_000);
  });
  if (new Set(packet.selected_paths.map((entry) => entry.path)).size !== packet.selected_paths.length) fail('packet.selected_paths contains duplicate paths');
  assertInteger(packet.omitted_path_count, 'packet.omitted_path_count', 0, 1_000_000);

  assertExactKeys(packet.risk, ['detectability', 'horizon', 'consequence', 'topology', 'evidence_strength', 'trust_surface'], ['detectability', 'horizon', 'consequence', 'topology', 'evidence_strength', 'trust_surface'], 'packet.risk');
  assertEnum(packet.risk.detectability, new Set(['strong', 'moderate', 'weak', 'unknown']), 'packet.risk.detectability');
  assertEnum(packet.risk.horizon, HORIZONS, 'packet.risk.horizon');
  assertEnum(packet.risk.consequence, new Set(['low', 'medium', 'high', 'critical']), 'packet.risk.consequence');
  assertEnum(packet.risk.topology, TOPOLOGIES, 'packet.risk.topology');
  assertEnum(packet.risk.evidence_strength, new Set(['strong', 'partial', 'missing', 'stale', 'failed']), 'packet.risk.evidence_strength');
  assertEnum(packet.risk.trust_surface, new Set(['normal', 'protected_boundary', 'critical_authority']), 'packet.risk.trust_surface');

  if (!Array.isArray(packet.evidence_refs) || packet.evidence_refs.length > 16) fail('packet.evidence_refs must contain at most 16 entries');
  packet.evidence_refs.forEach((entry, index) => validateEvidence(entry, index));
  if (new Set(packet.evidence_refs.map((entry) => entry.ref)).size !== packet.evidence_refs.length) fail('packet.evidence_refs must have unique refs');
  assertUniqueStringArray(packet.evidence_gaps, 'packet.evidence_gaps', { max: 16, itemMax: 512 });
  assertUniqueStringArray(packet.questions, 'packet.questions', { max: 6, itemMax: 512 });

  const budgetKeys = ['max_bytes', 'actual_bytes', 'max_changed_paths', 'selected_changed_paths', 'max_evidence_refs', 'selected_evidence_refs', 'max_questions', 'selected_questions', 'exceeded'];
  assertExactKeys(packet.budget, budgetKeys, budgetKeys, 'packet.budget');
  assertInteger(packet.budget.max_bytes, 'packet.budget.max_bytes', 4096, 65536);
  assertInteger(packet.budget.actual_bytes, 'packet.budget.actual_bytes', 1, 1_000_000);
  assertInteger(packet.budget.max_changed_paths, 'packet.budget.max_changed_paths', 1, 64);
  assertInteger(packet.budget.selected_changed_paths, 'packet.budget.selected_changed_paths', 0, 64);
  assertInteger(packet.budget.max_evidence_refs, 'packet.budget.max_evidence_refs', 1, 32);
  assertInteger(packet.budget.selected_evidence_refs, 'packet.budget.selected_evidence_refs', 0, 32);
  assertInteger(packet.budget.max_questions, 'packet.budget.max_questions', 1, 8);
  assertInteger(packet.budget.selected_questions, 'packet.budget.selected_questions', 0, 8);
  assertUniqueStringArray(packet.budget.exceeded, 'packet.budget.exceeded', { max: 4, itemMax: 32 });
  if (packet.budget.exceeded.some((entry) => !['bytes', 'changed_paths', 'evidence_refs', 'questions'].includes(entry))) fail('packet.budget.exceeded contains an unknown resource');
  if (packet.budget.selected_changed_paths !== packet.selected_paths.length || packet.budget.selected_evidence_refs !== packet.evidence_refs.length || packet.budget.selected_questions !== packet.questions.length) {
    fail('packet budget selected counts do not match packet content');
  }
  if (packet.budget.selected_changed_paths > packet.budget.max_changed_paths || packet.budget.selected_evidence_refs > packet.budget.max_evidence_refs || packet.budget.selected_questions > packet.budget.max_questions) {
    fail('packet selected content exceeds its declared caps');
  }
  assertSha256(packet.packet_sha256, 'packet.packet_sha256');
  if (sha256Value(packetHashMaterial(packet)) !== packet.packet_sha256) fail('packet hash does not match packet content');
  const computedBytes = computePacketBytes(packetHashMaterial(packet));
  if (computedBytes !== packet.budget.actual_bytes) fail('packet actual byte count does not match serialized content');
  if (computedBytes > packet.budget.max_bytes && !packet.budget.exceeded.includes('bytes')) fail('packet byte overflow is not declared');
  if (packet.budget.exceeded.length > 0 && packet.status !== 'budget_exceeded') fail('packet with exceeded budget must use budget_exceeded status');
  if (packet.status === 'budget_exceeded' && packet.budget.exceeded.length === 0) fail('budget_exceeded packet has no exceeded resource');
  return packet;
}

export function validateReviewResult(candidate, candidatePacket) {
  const packet = validateReviewPacket(candidatePacket);
  const result = cloneJson(candidate);
  const keys = [
    'schema_version', 'packet_sha256', 'head_sha', 'reviewer_role', 'verdict', 'question_coverage',
    'findings', 'evidence_request', 'implementation_modified', 'policy_override_attempted',
  ];
  assertExactKeys(result, keys, keys, 'review_result');
  if (result.schema_version !== REVIEW_RESULT_VERSION) fail(`unsupported review result schema_version ${result.schema_version}`);
  if (packet.status !== 'ready') fail(`review result is forbidden for packet status ${packet.status}`);
  if (packet.review_mode === 'mechanical_only') fail('mechanical_only packets must not invoke a reviewer');
  assertSha256(result.packet_sha256, 'review_result.packet_sha256');
  if (result.packet_sha256 !== packet.packet_sha256) fail('review result packet hash does not match');
  assertGitSha(result.head_sha, 'review_result.head_sha');
  if (result.head_sha !== packet.head_sha) fail('review result is stale for the packet head');
  assertEnum(result.reviewer_role, REVIEWER_ROLES, 'review_result.reviewer_role');
  if (packet.review_mode === 'focused_semantic' && !['focused_semantic', 'human'].includes(result.reviewer_role)) {
    fail('focused_semantic packet only allows the focused_semantic reviewer or a human');
  }
  if (['risk_scoped_specialists', 'human_critical'].includes(packet.review_mode) && result.reviewer_role !== 'human' && !packet.specialists.includes(result.reviewer_role)) {
    fail('reviewer role was not selected by the risk-scoped packet');
  }
  if (result.reviewer_role !== 'human' && !packet.questions.length) {
    fail('model reviewer requires bounded questions');
  }
  assertEnum(result.verdict, REVIEW_VERDICTS, 'review_result.verdict');
  assertBoolean(result.implementation_modified, 'review_result.implementation_modified');
  assertBoolean(result.policy_override_attempted, 'review_result.policy_override_attempted');
  if (result.implementation_modified) fail('reviewer may not modify implementation');
  if (result.policy_override_attempted) fail('reviewer may not override policy or verdict semantics');

  if (!Array.isArray(result.question_coverage) || result.question_coverage.length > 6) {
    fail('review_result.question_coverage must contain at most 6 entries');
  }
  const packetEvidenceByRef = new Map(packet.evidence_refs.map((entry) => [entry.ref, entry]));
  const assertPacketEvidenceRefs = (refs, label) => {
    for (const ref of refs) {
      if (!packetEvidenceByRef.has(ref)) fail(`${label} cites evidence outside the bounded packet: ${ref}`);
    }
  };
  const covered = new Set();
  const coverageAnswers = [];
  for (const [index, answer] of result.question_coverage.entries()) {
    const label = `review_result.question_coverage[${index}]`;
    assertExactKeys(answer, ['question', 'conclusion', 'evidence_refs'], ['question', 'conclusion', 'evidence_refs'], label);
    assertString(answer.question, `${label}.question`, { max: 512 });
    if (!packet.questions.includes(answer.question)) fail(`${label}.question is not in the packet`);
    if (covered.has(answer.question)) fail(`${label}.question is duplicated`);
    covered.add(answer.question);
    assertString(answer.conclusion, `${label}.conclusion`, { max: 512 });
    assertUniqueStringArray(answer.evidence_refs, `${label}.evidence_refs`, { max: 4, itemMax: 512 });
    assertPacketEvidenceRefs(answer.evidence_refs, `${label}.evidence_refs`);
    coverageAnswers.push(answer);
  }

  if (!Array.isArray(result.findings) || result.findings.length > 8) fail('review_result.findings must contain at most 8 entries');
  const findingIds = new Set();
  for (const [index, finding] of result.findings.entries()) {
    const label = `review_result.findings[${index}]`;
    const findingKeys = ['id', 'severity', 'category', 'status', 'disposition', 'in_scope', 'path', 'line', 'summary', 'evidence_refs'];
    assertExactKeys(finding, findingKeys, findingKeys, label);
    assertString(finding.id, `${label}.id`, { max: 64, pattern: /^[a-z][a-z0-9-]{0,63}$/ });
    if (findingIds.has(finding.id)) fail(`${label}.id is duplicated`);
    findingIds.add(finding.id);
    assertEnum(finding.severity, FINDING_SEVERITIES, `${label}.severity`);
    assertEnum(finding.category, FINDING_CATEGORIES, `${label}.category`);
    assertEnum(finding.status, FINDING_STATUSES, `${label}.status`);
    assertEnum(finding.disposition, FINDING_DISPOSITIONS, `${label}.disposition`);
    assertBoolean(finding.in_scope, `${label}.in_scope`);
    if (finding.path !== null) finding.path = normalizeRepositoryPath(finding.path);
    if (finding.line !== null) assertInteger(finding.line, `${label}.line`, 1, 10_000_000);
    assertString(finding.summary, `${label}.summary`, { max: 512 });
    assertUniqueStringArray(finding.evidence_refs, `${label}.evidence_refs`, { max: 4, itemMax: 512 });
    assertPacketEvidenceRefs(finding.evidence_refs, `${label}.evidence_refs`);
    if (finding.status === 'confirmed' && finding.path === null && finding.evidence_refs.length === 0) fail(`${label} confirmed finding requires a path or packet evidence`);
    if (finding.status === 'refuted' && finding.disposition !== 'refuted') fail(`${label} refuted status requires refuted disposition`);
    if (finding.status === 'unverified' && finding.disposition !== 'unverified') fail(`${label} unverified status requires unverified disposition`);
    if (finding.disposition === 'refuted' && finding.status !== 'refuted') fail(`${label} refuted disposition requires refuted status`);
    if (finding.disposition === 'unverified' && finding.status !== 'unverified') fail(`${label} unverified disposition requires unverified status`);
    if (finding.disposition === 'fix_now' && (!finding.in_scope || finding.status !== 'confirmed')) {
      fail(`${label} fix_now requires confirmed and in_scope`);
    }
  }

  if (result.evidence_request !== null) {
    assertExactKeys(result.evidence_request, ['items', 'reason', 'expected_information_gain'], ['items', 'reason', 'expected_information_gain'], 'review_result.evidence_request');
    assertUniqueStringArray(result.evidence_request.items, 'review_result.evidence_request.items', { min: 1, max: 4, itemMax: 128 });
    assertString(result.evidence_request.reason, 'review_result.evidence_request.reason', { max: 512 });
    assertString(result.evidence_request.expected_information_gain, 'review_result.evidence_request.expected_information_gain', { max: 512 });
  }

  const unresolvedFixNow = result.findings.filter((finding) => finding.status === 'confirmed' && finding.in_scope && finding.disposition === 'fix_now');
  const completeCoverage = packet.questions.every((question) => covered.has(question));
  if (result.verdict === 'advisory_clear') {
    if (!completeCoverage) fail('advisory_clear requires complete packet question coverage');
    for (const [index, answer] of coverageAnswers.entries()) {
      if (answer.evidence_refs.length === 0) fail(`advisory_clear requires packet evidence for question_coverage[${index}]`);
      for (const ref of answer.evidence_refs) {
        const evidence = packetEvidenceByRef.get(ref);
        if (evidence.head_sha !== packet.head_sha || evidence.status !== 'passed') {
          fail(`advisory_clear may cite only exact-head passed evidence: ${ref}`);
        }
      }
    }
    if (unresolvedFixNow.length > 0) fail('advisory_clear is forbidden with confirmed in-scope fix_now findings');
    if (result.evidence_request !== null) fail('advisory_clear cannot carry an evidence request');
  }
  if (result.verdict === 'fix_required' && unresolvedFixNow.length === 0) {
    fail('fix_required requires at least one confirmed in-scope fix_now finding');
  }
  if (['held', 'unverified'].includes(result.verdict) && result.evidence_request === null) {
    fail(`${result.verdict} requires one bounded evidence request`);
  }
  if (!['held', 'unverified'].includes(result.verdict) && result.evidence_request !== null) {
    fail(`${result.verdict} cannot carry an evidence request`);
  }
  return result;
}

export function evidenceFingerprint(candidateInput) {
  const input = validateInput(candidateInput);
  const normalized = input.evidence
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref) || a.head_sha.localeCompare(b.head_sha));
  return sha256Value({ head_sha: input.head_sha, evidence: normalized });
}

export function validateLoopInput(candidate) {
  const loop = cloneJson(candidate);
  assertExactKeys(loop, ['schema_version', 'max_attempts', 'max_evidence_delta_requests', 'attempts'], ['schema_version', 'max_attempts', 'max_evidence_delta_requests', 'attempts'], 'loop');
  if (loop.schema_version !== LOOP_INPUT_VERSION) fail(`unsupported loop schema_version ${loop.schema_version}`);
  if (loop.max_attempts !== 2 || loop.max_evidence_delta_requests !== 1) fail('loop budgets must match the bounded policy');
  if (!Array.isArray(loop.attempts) || loop.attempts.length > loop.max_attempts) fail('loop.attempts must remain within max_attempts');
  loop.attempts.forEach((attempt, index) => {
    const label = `loop.attempts[${index}]`;
    const keys = ['attempt', 'head_sha', 'policy_sha256', 'input_sha256', 'verification_manifest_sha256', 'evidence_fingerprint', 'action', 'expected_new_evidence', 'observed_new_evidence', 'decision'];
    assertExactKeys(attempt, keys, keys, label);
    if (attempt.attempt !== index + 1) fail(`${label}.attempt must be sequential and one-based`);
    assertGitSha(attempt.head_sha, `${label}.head_sha`);
    assertSha256(attempt.policy_sha256, `${label}.policy_sha256`);
    assertSha256(attempt.input_sha256, `${label}.input_sha256`);
    assertSha256(attempt.verification_manifest_sha256, `${label}.verification_manifest_sha256`);
    assertSha256(attempt.evidence_fingerprint, `${label}.evidence_fingerprint`);
    assertEnum(attempt.action, LOOP_ACTIONS, `${label}.action`);
    assertUniqueStringArray(attempt.expected_new_evidence, `${label}.expected_new_evidence`, { max: 8, itemMax: 128 });
    assertUniqueStringArray(attempt.observed_new_evidence, `${label}.observed_new_evidence`, { max: 8, itemMax: 128 });
    assertEnum(attempt.decision, LOOP_RESULTS, `${label}.decision`);
  });
  return loop;
}

export function advanceReviewLoop(candidateLoop) {
  const loop = validateLoopInput(candidateLoop);
  const used = loop.attempts.length;
  const deltaRequests = loop.attempts.filter((attempt) => attempt.action === 'evidence_request').length;
  const output = (state, reason) => ({
    schema_version: LOOP_DECISION_VERSION,
    state,
    reason,
    attempts_used: used,
    remaining_attempts: Math.max(0, loop.max_attempts - used),
    evidence_delta_requests_used: deltaRequests,
  });
  if (used === 0) return output('continue', 'initial_deterministic_collection_required');

  const latest = loop.attempts.at(-1);
  const identities = new Set(loop.attempts.map((attempt) => [
    attempt.head_sha,
    attempt.policy_sha256,
    attempt.input_sha256,
    attempt.verification_manifest_sha256,
  ].join(':')));
  if (identities.size > 1) return output('held', 'exact_identity_changed_restart_cycle');
  if (latest.decision === 'held') return output('held', 'attempt_reported_held');
  if (['advisory_pass', 'advisory_review', 'human_required', 'blocked'].includes(latest.decision)) {
    return output('complete', `terminal_decision_${latest.decision}`);
  }
  if (deltaRequests > loop.max_evidence_delta_requests) return output('held', 'evidence_delta_request_budget_exhausted');
  if (used >= 2) {
    const previous = loop.attempts.at(-2);
    if (previous.evidence_fingerprint === latest.evidence_fingerprint) return output('held', 'same_evidence_fingerprint_no_retry');
  }
  if (latest.observed_new_evidence.length === 0) return output('held', 'no_new_evidence_observed');
  if (used >= loop.max_attempts) return output('held', 'attempt_budget_exhausted');
  return output('continue', 'new_evidence_observed_within_budget');
}

export function replayCorpus(candidateCorpus, candidatePolicy) {
  const policy = validatePolicy(cloneJson(candidatePolicy));
  assertExactKeys(candidateCorpus, ['schema_version', 'cases'], ['schema_version', 'cases'], 'corpus');
  if (candidateCorpus.schema_version !== CORPUS_VERSION) fail(`unsupported corpus schema_version ${candidateCorpus.schema_version}`);
  if (!Array.isArray(candidateCorpus.cases) || candidateCorpus.cases.length < 20 || candidateCorpus.cases.length > 40) {
    fail('corpus.cases must contain 20-40 cases');
  }
  const ids = new Set();
  const results = [];
  for (const [index, testCase] of candidateCorpus.cases.entries()) {
    const label = `corpus.cases[${index}]`;
    assertExactKeys(testCase, ['id', 'input', 'expected'], ['id', 'input', 'expected'], label);
    assertString(testCase.id, `${label}.id`, { max: 64, pattern: /^[a-z][a-z0-9-]{0,63}$/ });
    if (ids.has(testCase.id)) fail(`duplicate corpus case id ${testCase.id}`);
    ids.add(testCase.id);
    assertExactKeys(testCase.expected, ['review_mode', 'verdict', 'topology', 'consequence', 'specialists_include'], ['review_mode', 'verdict', 'topology', 'consequence', 'specialists_include'], `${label}.expected`);
    assertEnum(testCase.expected.review_mode, MODE_SET, `${label}.expected.review_mode`);
    assertUniqueEnumArray(testCase.expected.specialists_include, SPECIALISTS, `${label}.expected.specialists_include`, { max: 2 });
    const decision = classifyReview(testCase.input, policy);
    const mismatches = [];
    for (const [expectedKey, actual] of [
      ['review_mode', decision.review_mode],
      ['verdict', decision.verdict],
      ['topology', decision.risk.topology],
      ['consequence', decision.risk.consequence],
    ]) {
      if (testCase.expected[expectedKey] !== actual) mismatches.push(`${expectedKey}: expected ${testCase.expected[expectedKey]}, got ${actual}`);
    }
    for (const specialist of testCase.expected.specialists_include) {
      if (!decision.specialists.includes(specialist)) mismatches.push(`specialists missing ${specialist}`);
    }
    results.push({ id: testCase.id, passed: mismatches.length === 0, mismatches, decision });
  }
  return {
    schema_version: 'review-risk-replay-report/v1',
    authority: 'advisory_shadow',
    policy_sha256: sha256Value(policy),
    total: results.length,
    passed: results.filter((entry) => entry.passed).length,
    failed: results.filter((entry) => !entry.passed).length,
    results,
  };
}

export const reviewRiskVersions = Object.freeze({
  policy: POLICY_VERSION,
  input: INPUT_VERSION,
  decision: DECISION_VERSION,
  packet: PACKET_VERSION,
  review_result: REVIEW_RESULT_VERSION,
  loop_input: LOOP_INPUT_VERSION,
  loop_decision: LOOP_DECISION_VERSION,
  corpus: CORPUS_VERSION,
});
