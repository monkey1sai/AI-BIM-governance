const PACKET_VERSION = 'task-packet/v2';
const CORPUS_VERSION = 'task-packet-corpus/v2';
const PACKET_KEYS = [
  'schema_version', 'id', 'lane', 'scope', 'owner', 'worktree_required', 'authorization_requirement', 'max_agents',
  'read_set', 'read_set_max', 'required_evidence', 'required_gates', 'allowed_agents', 'forbidden_actions', 'escalation',
];
const LANES = new Set(['F', 'B', 'G', 'S']);
const SCOPES = new Set([
  'docs_or_text', 'single_assertion', 'single_service_internal', 'single_service_non_symbol', 'cross_service', 'public_contract',
  'user_workflow', 'runtime_or_deploy', 'security_or_permission', 'explicit_spec',
]);
const READ_SET = new Set([
  'AGENTS.md', 'nearest:AGENTS.md', 'task:target_source', 'task:affected_tests', 'task:service_contract',
  'task:approved_spec', 'docs/agents/gitnexus-usage.md', 'docs/agents/sub-repo-verify-commands.md',
  'docs/agents/product-operability-and-script-contract.md', 'docs/agents/superpowers-invocation-policy.md',
  'docs/agents/github-workflow.md', 'docs/plans/docs-plans-README.md', 'scripts/verification-manifest.json',
]);
const EVIDENCE = new Set([
  'test_result', 'impact_result', 'contract_result', 'integration_result', 'browser_artifacts',
  'runtime_log', 'security_review', 'p0_p7_evidence',
]);
const GATES = new Set([
  'targeted', 'affected', 'impact', 'detect_changes', 'integration', 'browser_e2e', 'runtime_evidence',
  'security_review', 'pr_local_preflight', 'p0_p7',
]);
const AGENTS = new Set(['coordinator', 'debugger', 'explorer', 'reviewer', 'security_auditor']);
const FORBIDDEN_ACTIONS = new Set([
  'parallel_writers', 'implicit_superpowers', 'unapproved_ship_or_merge', 'unapproved_production_change',
  'unapproved_destructive_action', 'unapproved_cross_repo_access', 'unapproved_reindex',
]);
const ESCALATIONS = new Set(['scope_expansion', 'high_impact', 'critical_or_authority']);
const AUTHORIZATION_REQUIREMENTS = new Set(['none', 'external_explicit_user_instruction']);
const ALWAYS_FORBIDDEN = [...FORBIDDEN_ACTIONS];
const ROUTING_GUARDS = new Map([
  ['ordinary_completion_word', { assertion: 'must_not_trigger_lane_s', expected_minimum_lane: 'F', external_lane_s_authorization_required: false }],
  ['docs_only', { assertion: 'must_not_trigger_superpowers', expected_minimum_lane: 'F', external_lane_s_authorization_required: false }],
  ['test_only', { assertion: 'must_not_require_spec', expected_minimum_lane: 'F', external_lane_s_authorization_required: false }],
  ['implicit_skill', { assertion: 'must_remain_disabled', expected_minimum_lane: 'F', external_lane_s_authorization_required: false }],
  ['active_governance', { assertion: 'must_not_pin_model', expected_minimum_lane: 'F', external_lane_s_authorization_required: false }],
  ['public_contract_delete', { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false }],
  ['deploy_policy', { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false }],
  ['permission_boundary', { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false }],
  ['user_workflow', { assertion: 'requires_browser_e2e', expected_minimum_lane: 'G', external_lane_s_authorization_required: false }],
  ['real_fixture_workflow', { assertion: 'requires_real_runtime_fixture', expected_minimum_lane: 'G', external_lane_s_authorization_required: false }],
  ['explicit_spec_request', { assertion: 'requires_external_lane_s_authorization', expected_minimum_lane: 'S', external_lane_s_authorization_required: true }],
]);

function fail(message) {
  throw new Error(`task-packet: ${message}`);
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

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail(`${label} must be a bounded kebab-case id`);
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) fail(`${label} is not recognized`);
}

function assertEnumArray(value, allowed, label, { min = 1, max = 16 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must contain ${min}-${max} entries`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates`);
  value.forEach((entry, index) => assertEnum(entry, allowed, `${label}[${index}]`));
}

function requireEntries(packet, field, required) {
  for (const entry of required) {
    if (!packet[field].includes(entry)) fail(`${packet.id}.${field} must include ${entry}`);
  }
}

function requireOnly(packet, field, allowed) {
  for (const entry of packet[field]) {
    if (!allowed.includes(entry)) fail(`${packet.id}.${field} cannot include ${entry} for Lane ${packet.lane}`);
  }
}

function validateLaneContract(packet) {
  requireEntries(packet, 'forbidden_actions', ALWAYS_FORBIDDEN);
  if (packet.allowed_agents[0] !== 'coordinator') fail(`${packet.id}.allowed_agents must begin with coordinator`);
  if (packet.read_set.length > packet.read_set_max) fail(`${packet.id}.read_set exceeds read_set_max`);
  if (packet.lane === 'F') {
    if (!['docs_or_text', 'single_assertion', 'single_service_internal'].includes(packet.scope)) fail(`${packet.id}.scope is not valid for Lane F`);
    if (packet.worktree_required || packet.max_agents !== 1 || packet.authorization_requirement !== 'none') fail(`${packet.id} violates Lane F execution limits`);
    if (packet.allowed_agents.length !== 1 || packet.allowed_agents[0] !== 'coordinator') fail(`${packet.id} Lane F is coordinator-only`);
    requireOnly(packet, 'required_gates', ['targeted']);
    requireEntries(packet, 'required_evidence', ['test_result']);
    if (packet.read_set_max !== 4 || packet.escalation !== 'scope_expansion') fail(`${packet.id} violates Lane F context/escalation limits`);
    return;
  }
  if (packet.lane === 'B') {
    if (!['single_service_internal', 'single_service_non_symbol'].includes(packet.scope) || packet.worktree_required || packet.max_agents !== 2 || packet.authorization_requirement !== 'none') {
      fail(`${packet.id} violates Lane B scope/execution limits`);
    }
    requireOnly(packet, 'allowed_agents', ['coordinator', 'debugger', 'reviewer']);
    if (packet.allowed_agents.length !== 2) fail(`${packet.id} Lane B allows one optional specialist role`);
    requireEntries(packet, 'required_gates', ['affected']);
    requireEntries(packet, 'required_evidence', ['test_result']);
    if (packet.scope === 'single_service_internal') {
      requireEntries(packet, 'required_gates', ['impact']);
      requireEntries(packet, 'required_evidence', ['impact_result']);
      requireEntries(packet, 'read_set', ['docs/agents/gitnexus-usage.md', 'docs/agents/sub-repo-verify-commands.md']);
    } else {
      requireOnly(packet, 'required_gates', ['affected']);
      requireOnly(packet, 'required_evidence', ['test_result']);
    }
    if (packet.read_set_max !== 6 || packet.escalation !== 'high_impact') fail(`${packet.id} violates Lane B context/escalation limits`);
    return;
  }
  if (packet.lane === 'G') {
    if (!['cross_service', 'public_contract', 'user_workflow', 'runtime_or_deploy', 'security_or_permission'].includes(packet.scope)) fail(`${packet.id}.scope is not valid for Lane G`);
    if (!packet.worktree_required || packet.max_agents !== 3 || packet.allowed_agents.length !== 3 || packet.authorization_requirement !== 'none') {
      fail(`${packet.id} violates Lane G execution limits`);
    }
    requireEntries(packet, 'required_gates', ['affected', 'impact', 'detect_changes', 'integration', 'pr_local_preflight']);
    requireEntries(packet, 'required_evidence', ['test_result', 'impact_result', 'integration_result']);
    requireEntries(packet, 'read_set', ['docs/agents/gitnexus-usage.md', 'docs/agents/sub-repo-verify-commands.md']);
    if (packet.read_set_max !== 8 || packet.escalation !== 'critical_or_authority') fail(`${packet.id} violates Lane G context/escalation limits`);
    if (packet.scope === 'user_workflow') {
      requireEntries(packet, 'required_gates', ['browser_e2e']);
      requireEntries(packet, 'required_evidence', ['browser_artifacts']);
    }
    if (packet.scope === 'runtime_or_deploy') {
      requireEntries(packet, 'required_gates', ['runtime_evidence']);
      requireEntries(packet, 'required_evidence', ['runtime_log']);
    }
    if (packet.scope === 'security_or_permission') {
      requireEntries(packet, 'required_gates', ['security_review']);
      requireEntries(packet, 'required_evidence', ['security_review']);
      requireEntries(packet, 'allowed_agents', ['security_auditor']);
    }
    return;
  }
  if (packet.scope !== 'explicit_spec' || !packet.worktree_required || packet.authorization_requirement !== 'external_explicit_user_instruction' || packet.max_agents !== 3 || packet.allowed_agents.length !== 3) {
    fail(`${packet.id} violates Lane S external-authorization contract`);
  }
  requireEntries(packet, 'required_gates', ['p0_p7']);
  requireEntries(packet, 'required_evidence', ['p0_p7_evidence']);
  requireEntries(packet, 'read_set', ['task:approved_spec', 'docs/agents/superpowers-invocation-policy.md']);
  if (packet.read_set_max !== 8 || packet.escalation !== 'critical_or_authority') fail(`${packet.id} violates Lane S context/escalation limits`);
}

export function validateTaskPacket(packet) {
  assertExactKeys(packet, PACKET_KEYS, PACKET_KEYS, 'packet');
  if (packet.schema_version !== PACKET_VERSION) fail(`unsupported packet schema_version ${packet.schema_version}`);
  assertIdentifier(packet.id, 'packet.id');
  assertEnum(packet.lane, LANES, 'packet.lane');
  assertEnum(packet.scope, SCOPES, 'packet.scope');
  if (packet.owner !== 'coordinator') fail('packet.owner must be coordinator');
  if (typeof packet.worktree_required !== 'boolean') fail('packet.worktree_required must be boolean');
  assertEnum(packet.authorization_requirement, AUTHORIZATION_REQUIREMENTS, 'packet.authorization_requirement');
  if (!Number.isInteger(packet.max_agents) || packet.max_agents < 1 || packet.max_agents > 3) fail('packet.max_agents must be an integer from 1 to 3');
  if (!Number.isInteger(packet.read_set_max) || packet.read_set_max < 1 || packet.read_set_max > 8) fail('packet.read_set_max must be an integer from 1 to 8');
  assertEnumArray(packet.read_set, READ_SET, 'packet.read_set', { max: 8 });
  assertEnumArray(packet.required_evidence, EVIDENCE, 'packet.required_evidence', { max: 8 });
  assertEnumArray(packet.required_gates, GATES, 'packet.required_gates', { max: 10 });
  assertEnumArray(packet.allowed_agents, AGENTS, 'packet.allowed_agents', { max: 5 });
  assertEnumArray(packet.forbidden_actions, FORBIDDEN_ACTIONS, 'packet.forbidden_actions', { max: 7 });
  assertEnum(packet.escalation, ESCALATIONS, 'packet.escalation');
  validateLaneContract(packet);
  return packet;
}

function validateRoutingGuard(guard, index) {
  const label = `corpus.routing_guards[${index}]`;
  const guardKeys = ['id', 'signal', 'assertion', 'expected_minimum_lane', 'external_lane_s_authorization_required'];
  assertExactKeys(guard, guardKeys, guardKeys, label);
  assertIdentifier(guard.id, `${label}.id`);
  const expected = evaluateRoutingSignal(guard.signal);
  if (guard.assertion !== expected.assertion) fail(`${label}.assertion does not match ${guard.signal}`);
  if (guard.expected_minimum_lane !== expected.expected_minimum_lane) fail(`${label}.expected_minimum_lane does not match ${guard.signal}`);
  if (guard.external_lane_s_authorization_required !== expected.external_lane_s_authorization_required) {
    fail(`${label}.external_lane_s_authorization_required does not match ${guard.signal}`);
  }
}

export function evaluateRoutingSignal(signal) {
  const rule = ROUTING_GUARDS.get(signal);
  if (rule === undefined) fail(`routing signal is not recognized: ${signal}`);
  return { ...rule };
}

export function validateTaskPacketCorpus(corpus) {
  assertExactKeys(corpus, ['schema_version', 'tasks', 'routing_guards'], ['schema_version', 'tasks', 'routing_guards'], 'corpus');
  if (corpus.schema_version !== CORPUS_VERSION) fail(`unsupported corpus schema_version ${corpus.schema_version}`);
  if (!Array.isArray(corpus.tasks) || corpus.tasks.length < 12 || corpus.tasks.length > 20) fail('corpus.tasks must contain 12-20 packets');
  corpus.tasks.forEach(validateTaskPacket);
  const taskIds = corpus.tasks.map((packet) => packet.id);
  if (new Set(taskIds).size !== taskIds.length) fail('corpus task ids must be unique');
  for (const lane of LANES) {
    if (!corpus.tasks.some((packet) => packet.lane === lane)) fail(`corpus must cover Lane ${lane}`);
  }
  if (!Array.isArray(corpus.routing_guards) || corpus.routing_guards.length !== ROUTING_GUARDS.size) {
    fail(`corpus.routing_guards must contain exactly ${ROUTING_GUARDS.size} cases`);
  }
  corpus.routing_guards.forEach(validateRoutingGuard);
  const guardIds = corpus.routing_guards.map((guard) => guard.id);
  if (new Set(guardIds).size !== guardIds.length) fail('corpus routing guard ids must be unique');
  const guardSignals = corpus.routing_guards.map((guard) => guard.signal);
  if (new Set(guardSignals).size !== guardSignals.length) fail('corpus routing guard signals must be unique');
  for (const signal of ROUTING_GUARDS.keys()) {
    if (!guardSignals.includes(signal)) fail(`corpus must cover routing signal ${signal}`);
  }
  return corpus;
}

export const taskPacketVersions = Object.freeze({ packet: PACKET_VERSION, corpus: CORPUS_VERSION });
