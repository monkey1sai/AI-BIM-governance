import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateRoutingSignal, taskPacketVersions, validateTaskPacket, validateTaskPacketCorpus } from '../lib/task-packet.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..', '..');
const corpusPath = resolve(testDirectory, 'fixtures', 'agent-governance-routing.json');
const cliPath = resolve(repositoryRoot, 'scripts', 'dev', 'validate-task-packet.mjs');

function loadCorpus() {
  return JSON.parse(readFileSync(corpusPath, 'utf8'));
}

function lineCount(path) {
  return readFileSync(path, 'utf8').trimEnd().split(/\r?\n/).length;
}

test('golden corpus is a deterministic closed set of 16 task packets', () => {
  const corpus = loadCorpus();
  assert.equal(validateTaskPacketCorpus(corpus), corpus);
  assert.equal(corpus.schema_version, taskPacketVersions.corpus);
  assert.equal(corpus.tasks.length, 16);
  assert.deepEqual(Object.fromEntries(['F', 'B', 'G', 'S'].map((lane) => [lane, corpus.tasks.filter((packet) => packet.lane === lane).length])), {
    F: 4, B: 4, G: 6, S: 2,
  });
  assert.equal(JSON.stringify(validateTaskPacketCorpus(corpus)), JSON.stringify(validateTaskPacketCorpus(corpus)));
  assert.equal(corpus.tasks.some((packet) => Object.hasOwn(packet, 'prompt')), false, 'golden tasks contain expected packets, not retained prompt text');
});

test('every packet carries bounded read set, agent budget, gates, evidence, and escalation', () => {
  for (const packet of loadCorpus().tasks) {
    assert.equal(packet.schema_version, taskPacketVersions.packet, packet.id);
    assert.equal(packet.owner, 'coordinator', packet.id);
    assert(packet.read_set.length <= packet.read_set_max, packet.id);
    assert(packet.max_agents >= 1 && packet.max_agents <= 3, packet.id);
    assert(packet.required_gates.length > 0, packet.id);
    assert(packet.required_evidence.length > 0, packet.id);
    assert(packet.forbidden_actions.includes('parallel_writers'), packet.id);
    assert(packet.forbidden_actions.includes('unapproved_ship_or_merge'), packet.id);
    assert(packet.forbidden_actions.includes('unapproved_production_change'), packet.id);
    assert(packet.forbidden_actions.includes('unapproved_reindex'), packet.id);
  }
});

test('lane contracts encode the expected worktree, agents, and evidence boundaries', () => {
  const packets = loadCorpus().tasks;
  for (const packet of packets.filter(({ lane }) => lane === 'F')) {
    assert.equal(packet.worktree_required, false);
    assert.equal(packet.max_agents, 1);
    assert.deepEqual(packet.allowed_agents, ['coordinator']);
    assert.deepEqual(packet.required_gates, ['targeted']);
  }
  for (const packet of packets.filter(({ lane }) => lane === 'B')) {
    assert.equal(packet.worktree_required, false);
    assert.equal(packet.max_agents, 2);
    assert(packet.required_gates.includes('affected'));
    if (packet.scope === 'single_service_internal') assert(packet.required_gates.includes('impact'));
    if (packet.scope === 'single_service_non_symbol') assert.equal(packet.required_gates.includes('impact'), false);
  }
  for (const packet of packets.filter(({ lane }) => lane === 'G')) {
    assert.equal(packet.worktree_required, true);
    assert(packet.required_gates.includes('integration') && packet.required_gates.includes('pr_local_preflight'));
  }
  for (const packet of packets.filter(({ lane }) => lane === 'S')) {
    assert.equal(packet.authorization_requirement, 'external_explicit_user_instruction');
    assert.equal(Object.hasOwn(packet, 'explicit_trigger'), false);
    assert(packet.required_gates.includes('p0_p7'));
    assert(packet.read_set.includes('task:approved_spec'));
  }
});

test('high-risk scope-specific gates cannot be omitted', () => {
  const packets = loadCorpus().tasks;
  const userWorkflow = packets.find(({ scope }) => scope === 'user_workflow');
  assert(userWorkflow.required_gates.includes('browser_e2e'));
  assert(userWorkflow.required_evidence.includes('browser_artifacts'));
  for (const runtime of packets.filter(({ scope }) => scope === 'runtime_or_deploy')) {
    assert(runtime.required_gates.includes('runtime_evidence'));
    assert(runtime.required_evidence.includes('runtime_log'));
  }
  const permission = packets.find(({ scope }) => scope === 'security_or_permission');
  assert(permission.required_gates.includes('security_review'));
  assert(permission.allowed_agents.includes('security_auditor'));
});

test('routing guard corpus keeps explicit-only and minimum-lane regressions closed', () => {
  const guards = Object.fromEntries(loadCorpus().routing_guards.map((guard) => [guard.signal, {
    assertion: guard.assertion,
    expected_minimum_lane: guard.expected_minimum_lane,
    external_lane_s_authorization_required: guard.external_lane_s_authorization_required,
  }]));
  assert.deepEqual(guards, {
    ordinary_completion_word: { assertion: 'must_not_trigger_lane_s', expected_minimum_lane: 'F', external_lane_s_authorization_required: false },
    docs_only: { assertion: 'must_not_trigger_superpowers', expected_minimum_lane: 'F', external_lane_s_authorization_required: false },
    test_only: { assertion: 'must_not_require_spec', expected_minimum_lane: 'F', external_lane_s_authorization_required: false },
    implicit_skill: { assertion: 'must_remain_disabled', expected_minimum_lane: 'F', external_lane_s_authorization_required: false },
    active_governance: { assertion: 'must_not_pin_model', expected_minimum_lane: 'F', external_lane_s_authorization_required: false },
    public_contract_delete: { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false },
    deploy_policy: { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false },
    permission_boundary: { assertion: 'minimum_lane_g', expected_minimum_lane: 'G', external_lane_s_authorization_required: false },
    user_workflow: { assertion: 'requires_browser_e2e', expected_minimum_lane: 'G', external_lane_s_authorization_required: false },
    real_fixture_workflow: { assertion: 'requires_real_runtime_fixture', expected_minimum_lane: 'G', external_lane_s_authorization_required: false },
    explicit_spec_request: { assertion: 'requires_external_lane_s_authorization', expected_minimum_lane: 'S', external_lane_s_authorization_required: true },
  });
  for (const guard of loadCorpus().routing_guards) {
    assert.deepEqual(evaluateRoutingSignal(guard.signal), guards[guard.signal], guard.signal);
  }
  assert.equal(evaluateRoutingSignal('ordinary_completion_word').external_lane_s_authorization_required, false);
  assert.equal(evaluateRoutingSignal('explicit_spec_request').external_lane_s_authorization_required, true);
});

test('invalid lane packets and free-form fields fail closed', () => {
  const corpus = loadCorpus();
  const mutations = [];

  const freeForm = structuredClone(corpus.tasks[0]);
  freeForm.command = 'run anything';
  mutations.push([freeForm, /command is not allowed/]);

  const fastAgents = structuredClone(corpus.tasks.find(({ lane }) => lane === 'F'));
  fastAgents.max_agents = 2;
  mutations.push([fastAgents, /max_agents exceeds|Lane F execution limits/]);

  const boundedImpact = structuredClone(corpus.tasks.find(({ lane }) => lane === 'B'));
  boundedImpact.required_gates = boundedImpact.required_gates.filter((gate) => gate !== 'impact');
  mutations.push([boundedImpact, /must include impact/]);

  const nonSymbolImpact = structuredClone(corpus.tasks.find(({ scope }) => scope === 'single_service_non_symbol'));
  nonSymbolImpact.required_gates.push('impact');
  nonSymbolImpact.required_evidence.push('impact_result');
  mutations.push([nonSymbolImpact, /cannot include impact/]);

  const governedWorktree = structuredClone(corpus.tasks.find(({ lane }) => lane === 'G'));
  governedWorktree.worktree_required = false;
  mutations.push([governedWorktree, /Lane G execution limits/]);

  const browserGate = structuredClone(corpus.tasks.find(({ scope }) => scope === 'user_workflow'));
  browserGate.required_gates = browserGate.required_gates.filter((gate) => gate !== 'browser_e2e');
  mutations.push([browserGate, /must include browser_e2e/]);

  const securityAgent = structuredClone(corpus.tasks.find(({ scope }) => scope === 'security_or_permission'));
  securityAgent.allowed_agents = ['coordinator', 'explorer', 'reviewer'];
  mutations.push([securityAgent, /must include security_auditor/]);

  const specAuthority = structuredClone(corpus.tasks.find(({ lane }) => lane === 'S'));
  specAuthority.authorization_requirement = 'none';
  mutations.push([specAuthority, /Lane S external-authorization contract/]);

  const missingAuthorityBoundary = structuredClone(corpus.tasks[0]);
  missingAuthorityBoundary.forbidden_actions = missingAuthorityBoundary.forbidden_actions.filter((action) => action !== 'unapproved_production_change');
  mutations.push([missingAuthorityBoundary, /must include unapproved_production_change/]);

  for (const [packet, pattern] of mutations) assert.throws(() => validateTaskPacket(packet), pattern);

  const badGuard = structuredClone(corpus);
  badGuard.routing_guards[0].assertion = 'minimum_lane_g';
  assert.throws(() => validateTaskPacketCorpus(badGuard), /does not match/);

  const duplicateTaskId = structuredClone(corpus);
  duplicateTaskId.tasks[1].id = duplicateTaskId.tasks[0].id;
  assert.throws(() => validateTaskPacketCorpus(duplicateTaskId), /task ids must be unique/);

  const missingLane = structuredClone(corpus);
  missingLane.tasks = missingLane.tasks.filter(({ lane }) => lane !== 'S');
  assert.throws(() => validateTaskPacketCorpus(missingLane), /must cover Lane S/);

  const duplicateGuardSignal = structuredClone(corpus);
  duplicateGuardSignal.routing_guards[1].signal = duplicateGuardSignal.routing_guards[0].signal;
  duplicateGuardSignal.routing_guards[1].assertion = duplicateGuardSignal.routing_guards[0].assertion;
  duplicateGuardSignal.routing_guards[1].expected_minimum_lane = duplicateGuardSignal.routing_guards[0].expected_minimum_lane;
  duplicateGuardSignal.routing_guards[1].external_lane_s_authorization_required = false;
  assert.throws(() => validateTaskPacketCorpus(duplicateGuardSignal), /signals must be unique|must cover routing signal/);
});

test('schema is closed and covers both individual packets and the corpus envelope', () => {
  const schema = JSON.parse(readFileSync(resolve(testDirectory, 'task-packet.schema.json'), 'utf8'));
  assert.equal(schema.oneOf.length, 2);
  assert.equal(schema.definitions.task_packet.additionalProperties, false);
  assert.equal(schema.definitions.corpus.additionalProperties, false);
  assert.equal(schema.definitions.task_packet.properties.schema_version.const, taskPacketVersions.packet);
  assert.equal(schema.definitions.corpus.properties.schema_version.const, taskPacketVersions.corpus);
});

test('CLI is an executable bounded consumer of the golden corpus', () => {
  const result = spawnSync(process.execPath, [cliPath, '--input', corpusPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const validation = JSON.parse(result.stdout);
  assert.deepEqual({ valid: validation.valid, kind: validation.kind, packet_count: validation.packet_count }, {
    valid: true, kind: 'corpus', packet_count: 16,
  });
  assert.equal(validation.authorization_granted, false);
  assert.equal(validation.authorization_scope, 'validation_only');
  assert.equal(validation.external_lane_s_authorization_required, true);
});

test('root startup context does not grow and legacy skill lock remains absent', () => {
  assert(lineCount(resolve(repositoryRoot, 'AGENTS.md')) <= 200);
  assert(lineCount(resolve(repositoryRoot, 'CLAUDE.md')) <= 30);
  assert.equal(existsSync(resolve(repositoryRoot, 'skills-lock.json')), false);
  const readme = readFileSync(resolve(repositoryRoot, '.claude', 'skills', 'README.md'), 'utf8');
  assert.match(readme, /唯一 inventory\/provenance truth/);
});
