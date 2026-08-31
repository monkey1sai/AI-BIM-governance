import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

const FABRIC_CHANGE = 'openspec/changes/parallel-delivery-fabric';
const CANONICAL_PHASES = [
  'LEGACY_GUARDED',
  'SHADOW_DUAL',
  'CUTOVER_ARMED',
  'CANARY_ACTIVE',
  'AUTONOMOUS_ACTIVE',
];
const PROMOTION_MODES = ['single_pr', 'direct_stack'];
const TERMINAL_CLASSES = ['DELIVERED', 'FAILED', 'HELD'];
const ACTIVATION_RECORD_FIELDS = [
  'phase',
  'base_sha',
  'policy_digest',
  'writer_cap',
  'external_check_name',
  'external_app_id',
  'activated_at',
];

function lines(text) {
  return text.split(/\r?\n/u);
}

function codeTokens(text) {
  return [...text.matchAll(/`([^`\r\n]+)`/gu)].map((match) => match[1].trim());
}

function clauses(text) {
  return text.split(/\r?\n|(?<=[.!?。])\s*/u).map((value) => value.trim()).filter(Boolean);
}

function findClause(text, predicate, label) {
  const clause = clauses(text).find(predicate);
  assert.ok(clause, `missing semantic clause: ${label}`);
  return clause;
}

function findClauses(text, predicate, label) {
  const found = clauses(text).filter(predicate);
  assert.ok(found.length > 0, `missing semantic clauses: ${label}`);
  return found;
}

function extractRequirementSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of lines(markdown)) {
    const header = line.match(/^### Requirement:\s+(.+)$/u);
    if (header !== null) {
      if (current !== null) sections.push(current);
      current = { title: header[1], bodyLines: [] };
    } else if (current !== null) {
      current.bodyLines.push(line);
    }
  }
  if (current !== null) sections.push(current);
  return sections.map((section) => ({ ...section, body: section.bodyLines.join('\n') }));
}

function requirement(markdown, title) {
  const section = extractRequirementSections(markdown).find((candidate) => candidate.title === title);
  assert.ok(section, `missing requirement section: ${title}`);
  return section;
}

function extractScenarioSections(section) {
  const scenarios = [];
  let current = null;
  for (const line of section.bodyLines) {
    const header = line.match(/^#### Scenario:\s+(.+)$/u);
    if (header !== null) {
      if (current !== null) scenarios.push(current);
      current = { title: header[1], bodyLines: [] };
    } else if (current !== null) {
      current.bodyLines.push(line);
    }
  }
  if (current !== null) scenarios.push(current);
  return scenarios.map((scenario) => ({ ...scenario, body: scenario.bodyLines.join('\n') }));
}

function scenario(section, title) {
  const found = extractScenarioSections(section).find((candidate) => candidate.title === title);
  assert.ok(found, `missing scenario: ${title}`);
  return found;
}

function requirementProse(section) {
  const firstScenario = section.bodyLines.findIndex((line) => line.startsWith('#### Scenario:'));
  return section.bodyLines.slice(0, firstScenario === -1 ? undefined : firstScenario).join('\n');
}

function headingSection(markdown, heading) {
  const sourceLines = lines(markdown);
  const start = sourceLines.findIndex((line) => line === heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const level = heading.match(/^(#+) /u)[1].length;
  const body = [];
  for (const line of sourceLines.slice(start + 1)) {
    const next = line.match(/^(#+) /u);
    if (next !== null && next[1].length <= level) break;
    body.push(line);
  }
  return body.join('\n');
}

function arrowEnum(text, label) {
  const clause = findClause(text, (value) => value.includes(label) && codeTokens(value).some((token) => token.includes('->')), label);
  const encoded = codeTokens(clause).find((token) => token.includes('->'));
  return encoded.split('->').map((value) => value.trim());
}

function barEnum(text, label) {
  const clause = findClause(text, (value) => value.includes(label) && codeTokens(value).some((token) => token.includes('|')), label);
  const encoded = codeTokens(clause).find((token) => token.includes('|'));
  return encoded.split('|').map((value) => value.trim());
}

function terminalEnum(section) {
  const clause = findClause(section.body, (value) => value.includes('terminal class') && value.includes('only allow'), 'closed terminal class');
  const encoded = clause.match(/terminal class\s+SHALL only allow\s+(.+)$/u);
  assert.ok(encoded, 'closed terminal class must expose its enum after only allow');
  return codeTokens(encoded[1]);
}

function assertExactEnum(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} must be the canonical closed sequence`);
}

function parseNowProjection(nowText) {
  const projection = nowText.match(/<!-- lifecycle-ledger:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- lifecycle-ledger:end -->/u);
  assert.ok(projection, 'NOW must contain one JSON lifecycle projection');
  return JSON.parse(projection[1]);
}

function taskCounts(tasksText) {
  const { completed, total, unsupported } = taskLedgerFromText(tasksText);
  assert.equal(unsupported, 0, 'canonical Fabric tasks must not contain malformed, nested, or prose checkbox markers');
  return { completed, total };
}

function taskLedgerFromText(tasksText) {
  let completed = 0;
  let total = 0;
  let unsupported = 0;
  for (const line of lines(tasksText)) {
    const match = line.match(/^- \[([^\]]*)\](.?)/u);
    if (match === null) {
      if (/^[ \t]+-[ \t]+\[[^\]]*\]/u.test(line) || /-\s+\[[^\]]*\]/u.test(line)) unsupported += 1;
      continue;
    }
    const [, mark, after] = match;
    if (mark.length !== 1) {
      if (mark.length >= 2 && /^[ \t]*[xX]?[ \t]*$/u.test(mark)) unsupported += 1;
      continue;
    }
    if (after !== '' && !/^[ \t]$/u.test(after)) {
      unsupported += 1;
      continue;
    }
    if (mark === 'x' || mark === 'X') {
      completed += 1;
      total += 1;
    } else if (mark === ' ') {
      total += 1;
    } else {
      unsupported += 1;
    }
  }
  return {
    completed,
    total,
    unsupported,
  };
}

function phaseGuardClauses(markdown) {
  return findClauses(markdown,
    (value) => CANONICAL_PHASES.some((phase) => value.includes(`\`${phase}\``))
      && /(counted review|review gate|old gate|legacy gate|human merge authority|required_approving_review_count|require_code_owner_reviews|add-before-remove|retire|remov|replace|取代)/iu.test(value),
    'phase review guards');
}

function allowsCountedReviewRetirement(clause) {
  return /(add-before-remove|retire|remov|replace|取代|required_approving_review_count=0|require_code_owner_reviews=false)/iu.test(clause)
    && !/(SHALL NOT|不得|保持live|remain live|keep.*live)/iu.test(clause);
}

function activationRetirementErrors(markdown) {
  const guards = phaseGuardClauses(markdown);
  const errors = [];
  if (guards.some((clause) => allowsCountedReviewRetirement(clause)
      && (clause.includes('`CUTOVER_ARMED`') || clause.includes('`CANARY_ACTIVE`')))) {
    errors.push('pre_autonomy_counted_review_retirement');
  }
  const retirementClauses = guards.filter(allowsCountedReviewRetirement);
  if (retirementClauses.length === 0) {
    errors.push('missing_autonomous_retirement_guard');
  }
  for (const clause of retirementClauses) {
    const hasCompleteGuard = clause.includes('`AUTONOMOUS_ACTIVE`')
      && /activation record.*(?:驗證|validat)/iu.test(clause)
      && /canary.*`DELIVERED`|`DELIVERED`.*canary/iu.test(clause)
      && /(?:fresh |authoritative )?reread/iu.test(clause);
    if (!hasCompleteGuard) {
      errors.push('retirement_guard_incomplete');
      break;
    }
  }
  return errors;
}

function activationCanaryClauses(markdown) {
  return clauses(markdown).filter((value) => /`CUTOVER_ARMED`|`CANARY_ACTIVE`|`activation_canary`|\bcanary\b/iu.test(value));
}

function machineMergeSinkEnabled(clause) {
  return /machine merge sink(?:\s+(?:is|becomes?|shall be|must be|remains?))?\s+enabled|machine merge sink(?:已|為|是)?啟用/iu.test(clause)
    && !/(?:SHALL NOT|不得|not)\s*(?:be\s*)?(?:enabled|啟用)/iu.test(clause);
}

function canaryDualGateErrors(markdown) {
  const canaryClauses = activationCanaryClauses(markdown);
  const errors = [];
  if (canaryClauses.some((value) => /(machine-only|no[- ]review|without (?:the )?(?:old |counted )?review|approval(?: count)?\s*(?:=|to)?\s*0|old gate (?:is )?absent)/iu.test(value)
      && !value.includes('`AUTONOMOUS_ACTIVE`'))) {
    errors.push('pre_autonomy_machine_or_review_bypass');
  }
  if (canaryClauses.some((value) => machineMergeSinkEnabled(value)
      && !value.includes('`AUTONOMOUS_ACTIVE`'))) {
    errors.push('machine_merge_sink_enabled_pre_autonomy');
  }
  const dualGateClause = canaryClauses.some((value) => value.includes('`CANARY_ACTIVE`')
    && /counted review/iu.test(value)
    && /source-pinned (?:external )?(?:CheckRun|check)/iu.test(value));
  if (!dualGateClause) errors.push('canary_dual_gate_missing');
  return errors;
}

function machineOnlyPathErrors(markdown) {
  const premature = clauses(markdown).filter((value) => /machine-only/iu.test(value)
    && !/SHALL NOT|不得/iu.test(value)
    && !value.includes('`AUTONOMOUS_ACTIVE`'));
  return premature.length === 0 ? [] : ['machine_only_before_autonomous'];
}

function deltaRequirementHeadings(markdown) {
  const headings = [];
  let kind = null;
  for (const line of lines(markdown)) {
    const section = line.match(/^## (ADDED|MODIFIED|REMOVED) Requirements$/u);
    if (section !== null) {
      kind = section[1];
      continue;
    }
    const requirementHeader = line.match(/^### Requirement:\s+(.+)$/u);
    if (kind !== null && requirementHeader !== null) headings.push({ kind, title: requirementHeader[1] });
  }
  return headings;
}

function validatePhase0SpecificationFixture({ activationRequirement, promotionRequirement, terminalRequirement }) {
  const errors = [];
  const activation = extractRequirementSections(activationRequirement)[0];
  const phases = arrowEnum(activation.body, 'phase enum');
  if (JSON.stringify(phases) !== JSON.stringify(CANONICAL_PHASES)) errors.push('phase_sequence_invalid');

  const aliasScenario = extractScenarioSections(activation)[0];
  const aliasWhen = findClause(aliasScenario.body, (value) => value.startsWith('- **WHEN**'), 'alias scenario WHEN');
  const aliasThen = findClause(aliasScenario.body, (value) => value.startsWith('- **THEN**'), 'alias scenario THEN');
  const aliasInputs = codeTokens(aliasWhen);
  if (!/reject/iu.test(aliasThen)) errors.push('alias_not_rejected');
  if (aliasInputs.includes('LEGACY_GUARDED') && aliasInputs.includes('AUTONOMOUS_ACTIVE')) {
    errors.push('skipped_phase_allowed');
  }

  const promotion = barEnum(promotionRequirement, 'Promotion modes');
  if (JSON.stringify(promotion) !== JSON.stringify(PROMOTION_MODES)) errors.push('promotion_mode_unknown');

  const terminalClause = findClause(terminalRequirement,
    (value) => value.includes('terminal class') && value.includes('only allow'), 'fixture terminal class');
  if (JSON.stringify(codeTokens(terminalClause)) !== JSON.stringify(TERMINAL_CLASSES)) {
    errors.push('terminal_class_widened');
  }

  return { valid: errors.length === 0, errors };
}

test('Phase 0 has one canonical, inactive-until-attested delivery authority', () => {
  // Phase 0 validates canonical document structure only. Task 11 owns runtime
  // queue/trust-root/policy fixtures and they are intentionally not loaded here.
  const fabricFiles = [
    'proposal.md',
    'design.md',
    'tasks.md',
    'specs/parallel-delivery-fabric/spec.md',
  ].map((suffix) => `${FABRIC_CHANGE}/${suffix}`);
  const design = read('docs/superpowers/specs/2026-08-28-parallel-delivery-fabric-design.md');
  const status = lines(design).find((line) => line.startsWith('> 狀態：'));
  assert.ok(status && !status.includes('Draft'), 'approved design must not retain Draft status');
  for (const relativePath of fabricFiles) assert.ok(exists(relativePath), `missing canonical Fabric artifact: ${relativePath}`);

  const fabricDesign = read(`${FABRIC_CHANGE}/design.md`);
  const fabricSpec = read(`${FABRIC_CHANGE}/specs/parallel-delivery-fabric/spec.md`);
  const fabricAuthority = headingSection(fabricDesign, '## Authority boundary');
  assertExactEnum(arrowEnum(fabricAuthority, 'activation order'), ['shadow', 'canary', 'active'], 'Fabric activation order');

  const activationRequirement = requirement(fabricSpec, 'Fabric activation shall be record-gated');
  const activationProse = requirementProse(activationRequirement);
  const recordClause = findClause(activationProse, (value) => value.includes('record SHALL contain'), 'activation record fields');
  assertExactEnum(codeTokens(recordClause), ACTIVATION_RECORD_FIELDS, 'activation record fields');
  const capacityTokens = clauses(activationProse)
    .filter((value) => value.includes('writer_cap=1') || value.includes('writer_cap=2') || value.includes('direct_stack'))
    .flatMap(codeTokens);
  assert.deepEqual(capacityTokens, ['writer_cap=1', 'writer_cap=2', 'direct_stack', 'HELD'],
    'record-gated capacity must retain cap=1 and hold direct stack before cap=2');
  const inactiveScenario = scenario(activationRequirement, 'An inactive record cannot expand writer capacity');
  assert.ok(clauses(inactiveScenario.body).some((value) => value.startsWith('- **THEN**') && value.includes('at most one writer')),
    'inactive record scenario must admit only one writer');

  const phaseRequirement = requirement(fabricSpec, 'Review activation phases shall be closed and one-way');
  assertExactEnum(arrowEnum(phaseRequirement.body, 'phase enum'), CANONICAL_PHASES, 'Fabric review phases');
  const aliasScenario = scenario(phaseRequirement, 'A review alias is submitted');
  const aliasWhen = findClause(aliasScenario.body, (value) => value.startsWith('- **WHEN**'), 'review alias WHEN');
  const aliasThen = findClause(aliasScenario.body, (value) => value.startsWith('- **THEN**'), 'review alias THEN');
  assert.deepEqual(codeTokens(aliasWhen), ['CANARY', 'ACTIVE'], 'alias scenario must name rejected aliases');
  assert.ok(aliasThen.includes('policy fixture') && /rejects/iu.test(aliasThen) && codeTokens(aliasThen).includes('HELD'),
    'alias scenario must reject aliases and hold delivery');
  const migrationClause = findClause(phaseRequirement.body, (value) => value.includes('add-before-remove'), 'review migration guard');
  assert.ok(migrationClause.includes('source-pinned external CheckRun') && migrationClause.includes('observed active') && migrationClause.includes('counted review'),
    'counted review cannot retire before the active source-pinned external CheckRun');

  const historicalRequirement = requirement(fabricSpec, 'Phase 0 shall preserve historical governance evidence');
  const closureScenario = scenario(historicalRequirement, 'A closure change is proposed');
  assert.ok(historicalRequirement.body.includes('byte-frozen') && historicalRequirement.body.includes('ordinary protected PR'),
    'historical lifecycle ledger must remain byte-frozen with ordinary protected closure');
  assert.ok(clauses(closureScenario.body).some((value) => value.startsWith('- **THEN**') && value.includes('byte-identical')),
    'closure scenario must preserve historical ledger bytes');

  const agents = read('AGENTS.md');
  const singleWriterRule = lines(agents).find((line) => line.includes('Single Active Writer 原則'));
  assert.ok(singleWriterRule?.includes('activation record') && singleWriterRule.includes('writer_cap=1') && singleWriterRule.includes('direct_stack') && singleWriterRule.includes('HELD'),
    'live policy must retain single writer until the activation record validates capacity');

  const autonomousProposal = read('openspec/changes/autonomous-linux-delivery/proposal.md');
  const autonomousDesign = read('openspec/changes/autonomous-linux-delivery/design.md');
  const autonomousTasks = read('openspec/changes/autonomous-linux-delivery/tasks.md');
  const autonomousSpec = read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md');
  const reviewSpec = read('openspec/changes/autonomous-linux-delivery/specs/pull-request-review-agent/spec.md');
  const governanceSpec = read('openspec/changes/autonomous-linux-delivery/specs/ai-coding-governance/spec.md');

  const classificationRequirement = requirement(autonomousSpec, 'Every protected-branch PR SHALL belong to one closed, record-gated class');
  assertExactEnum(barEnum(classificationRequirement.body, 'promotion mode'), PROMOTION_MODES, 'promotion modes');
  assert.ok(classificationRequirement.body.includes('mutually exclusive') && classificationRequirement.body.includes('不得中途切換'),
    'promotion mode must not switch after exact tuple binding');
  const terminalRequirement = requirement(autonomousSpec, 'Delivery transaction SHALL use a closed phase, terminal-class and reason-code schema');
  assertExactEnum(terminalEnum(terminalRequirement), TERMINAL_CLASSES, 'external terminal classes');
  const terminalScenario = scenario(terminalRequirement, 'Internal reason被發布成未知terminal state');
  const terminalWhen = findClause(terminalScenario.body, (value) => value.startsWith('- **WHEN**'), 'terminal invalid WHEN');
  assert.ok(codeTokens(terminalWhen).includes('STACK_*'), 'STACK_* must be rejected as an external terminal value');
  assert.ok(!terminalEnum(terminalRequirement).some((value) => value.startsWith('STACK_')),
    'closed external terminal set must exclude STACK_*');

  const autonomousActivation = requirement(autonomousSpec, 'Activation SHALL add and attest machine authority before removing human requirements');
  assertExactEnum(arrowEnum(autonomousActivation.body, 'phase enum'), CANONICAL_PHASES, 'active autonomous review phases');
  const autonomousActivationProse = requirementProse(autonomousActivation);
  for (const expected of ['external CheckRun', 'external-settings lease', 'rollback snapshot', 'add-before-remove', 'authoritative reread']) {
    assert.ok(autonomousActivationProse.includes(expected), `CUTOVER_ARMED must require ${expected}`);
  }

  const reviewMigration = requirement(reviewSpec, 'Counted review retirement SHALL be add-before-remove and record-gated');
  const externalCheckScenario = scenario(reviewMigration, 'The external check is not active');
  const externalCheckThen = findClause(externalCheckScenario.body, (value) => value.startsWith('- **THEN**'), 'external check inactive THEN');
  assert.ok(externalCheckThen.includes('counted review SHALL remain live'),
    'old counted review remains live until source-pinned external check is active');
  const governanceMigration = requirement(governanceSpec, 'Autonomous review activation SHALL preserve the live counted review until attested');
  assert.ok(governanceMigration.body.includes('add-before-remove') && governanceMigration.body.includes('source-pinned external CheckRun'),
    'governance projection must preserve the source-pinned add-before-remove contract');

  assert.ok(autonomousProposal.includes('single_pr|direct_stack') && autonomousDesign.includes('byte-frozen') && autonomousTasks.includes('Superseded by `parallel-delivery-fabric`'),
    'autonomous-delivery delta must carry the reconciled promotion and lifecycle contract');

  const lifecycleLedger = JSON.parse(read('openspec/lifecycle-ledger.json'));
  const fabricRows = lifecycleLedger.changes.filter(({ id }) => id === 'parallel-delivery-fabric');
  assert.equal(fabricRows.length, 1, 'lifecycle ledger must contain exactly one Fabric row');
  const fabricRow = fabricRows[0];
  assert.deepEqual(Object.keys(fabricRow).sort(), [
    'archive_debt', 'blocked_by', 'current_slice', 'evidence_refs', 'id', 'last_verified',
    'owner', 'status', 'subject_binding', 'subject_commit', 'task_ledger',
  ].sort(), 'Fabric lifecycle row must preserve the closed row shape');
  assert.equal(fabricRow.status, 'active');
  assert.equal(fabricRow.owner, 'parallel-delivery-fabric');
  assert.match(fabricRow.current_slice, /phase0-governance/u);
  assert.deepEqual(fabricRow.blocked_by, []);
  assert.deepEqual(Object.keys(fabricRow.task_ledger).sort(), ['completed', 'total']);
  assert.deepEqual(fabricRow.task_ledger, taskCounts(read(`${FABRIC_CHANGE}/tasks.md`)),
    'lifecycle task counts must be derived from the canonical Fabric task list');
  assert.equal(fabricRow.subject_commit, 'df227cc1e07cb0bb6a683ef4c6df6c9f22284529');
  assert.equal(fabricRow.subject_binding, 'introduction');
  assert.equal(fabricRow.archive_debt, null);
  for (const reference of [
    `${FABRIC_CHANGE}/proposal.md`,
    `${FABRIC_CHANGE}/tasks.md`,
    'docs/superpowers/specs/2026-08-28-parallel-delivery-fabric-design.md',
    'scripts/tests/test-parallel-delivery-fabric-phase0.mjs',
  ]) assert.ok(fabricRow.evidence_refs.includes(reference), `missing lifecycle evidence reference: ${reference}`);

  const nowText = read('docs/plans/NOW.md');
  const nowDocument = parseNowProjection(nowText);
  const nowRows = nowDocument.changes.filter(({ id }) => id === 'parallel-delivery-fabric');
  assert.equal(nowRows.length, 1, 'NOW must project the Fabric row exactly once');
  assert.deepEqual(nowRows[0], { id: 'parallel-delivery-fabric', status: 'active' },
    'NOW Fabric row must preserve the closed projection shape');
  const phase0Section = headingSection(nowText, '## Parallel Delivery Fabric Phase 0');
  assert.ok(phase0Section.includes('shadow 並不代表已啟用交付') && phase0Section.includes('不授權第二 writer'),
    'NOW must retain the shadow/non-live delivery boundary');
});

test('structured Phase 0 parser rejects legacy activation fixtures without runtime adapters', () => {
  // This is a local specification fixture. Queue/trust-root/policy runtime
  // fixtures belong to Task 11 and are intentionally not loaded here.
  const legacyFixture = {
    activationRequirement: [
      '### Requirement: Review activation phases shall be closed and one-way',
      '',
      'The accepted phase enum is `LEGACY_GUARDED -> SHADOW_DUAL -> CUTOVER_ARMED -> CANARY_ACTIVE -> AUTONOMOUS_ACTIVE`.',
      '',
      '#### Scenario: An alias skips the review migration',
      '',
      '- **WHEN** an input uses `CANARY` and moves directly from `LEGACY_GUARDED` to `AUTONOMOUS_ACTIVE`',
      '- **THEN** the policy fixture accepts the alias',
    ].join('\n'),
    promotionRequirement: 'Promotion modes are `single_pr|direct_stack|hybrid`.',
    terminalRequirement: 'terminal class SHALL only allow `DELIVERED`, `FAILED`, `HELD`, and `STACK_MERGED`.',
  };

  assert.deepEqual(validatePhase0SpecificationFixture(legacyFixture), {
    valid: false,
    errors: ['alias_not_rejected', 'skipped_phase_allowed', 'promotion_mode_unknown', 'terminal_class_widened'],
  });
});

test('activation sources keep every CUTOVER and CANARY clause from retiring counted review early', () => {
  const activationTasks = headingSection(
    read('openspec/changes/autonomous-linux-delivery/tasks.md'),
    '## 7. Self-referential bootstrap 與一次性 activation',
  );
  const sourceErrors = {
    design: activationRetirementErrors(read('openspec/changes/autonomous-linux-delivery/design.md')),
    specification: activationRetirementErrors(read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md')),
    tasks: activationRetirementErrors(activationTasks),
  };

  assert.deepEqual(sourceErrors, { design: [], specification: [], tasks: [] },
    'every phase/guard clause must preserve counted review until a complete AUTONOMOUS_ACTIVE retirement guard');
});

test('activation guard rejects hostile CUTOVER, CANARY, and incomplete AUTONOMOUS retirement fixtures', () => {
  const cutoverFixture = '`CUTOVER_ARMED` may retire the existing counted review after adding the external check.';
  const canaryFixture = '`CANARY_ACTIVE` may remove the old gate after the disposable canary starts.';
  const incompleteAutonomousFixture = '`AUTONOMOUS_ACTIVE` may retire counted review when the activation record is validated.';

  assert.deepEqual(activationRetirementErrors(cutoverFixture), [
    'pre_autonomy_counted_review_retirement',
    'retirement_guard_incomplete',
  ]);
  assert.deepEqual(activationRetirementErrors(canaryFixture), [
    'pre_autonomy_counted_review_retirement',
    'retirement_guard_incomplete',
  ]);
  assert.deepEqual(activationRetirementErrors(incompleteAutonomousFixture), [
    'retirement_guard_incomplete',
  ]);
});

test('activation sources keep CUTOVER and CANARY dual-gated until AUTONOMOUS_ACTIVE', () => {
  const activationTasks = headingSection(
    read('openspec/changes/autonomous-linux-delivery/tasks.md'),
    '## 7. Self-referential bootstrap 與一次性 activation',
  );
  const sourceErrors = {
    design: canaryDualGateErrors(read('openspec/changes/autonomous-linux-delivery/design.md')),
    specification: canaryDualGateErrors(read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md')),
    tasks: canaryDualGateErrors(activationTasks),
  };

  assert.deepEqual(sourceErrors, { design: [], specification: [], tasks: [] },
    'CUTOVER/CANARY wording must keep both the counted review and source-pinned check, without a machine-only or review-bypass path');
});

test('canary dual-gate collector rejects hostile machine-only and review-bypass fixtures', () => {
  const machineOnlyFixture = '`CANARY_ACTIVE` runs `activation_canary` on a machine-only exact-head path.';
  const noReviewFixture = '`CANARY_ACTIVE` runs `activation_canary` with the old gate absent.';

  assert.deepEqual(canaryDualGateErrors(machineOnlyFixture), [
    'pre_autonomy_machine_or_review_bypass',
    'canary_dual_gate_missing',
  ]);
  assert.deepEqual(canaryDualGateErrors(noReviewFixture), [
    'pre_autonomy_machine_or_review_bypass',
    'canary_dual_gate_missing',
  ]);
});

test('canary dual-gate collector rejects a sink-enabled hostile fixture before AUTONOMOUS_ACTIVE', () => {
  const sinkEnabledFixture = '`CANARY_ACTIVE` runs `activation_canary` with existing counted review and a source-pinned external CheckRun, but the machine merge sink enabled.';

  assert.deepEqual(canaryDualGateErrors(sinkEnabledFixture), [
    'machine_merge_sink_enabled_pre_autonomy',
  ]);
});

test('machine-only wording is permitted only after AUTONOMOUS_ACTIVE', () => {
  const activationTasks = headingSection(
    read('openspec/changes/autonomous-linux-delivery/tasks.md'),
    '## 7. Self-referential bootstrap 與一次性 activation',
  );
  const sourceErrors = {
    design: machineOnlyPathErrors(read('openspec/changes/autonomous-linux-delivery/design.md')),
    specification: machineOnlyPathErrors(read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md')),
    tasks: machineOnlyPathErrors(activationTasks),
  };

  assert.deepEqual(sourceErrors, { design: [], specification: [], tasks: [] });
  assert.deepEqual(machineOnlyPathErrors('`CANARY_ACTIVE` may use a machine-only exact-head path.'), [
    'machine_only_before_autonomous',
  ]);
});

test('Task 7 collector rejects a pre-AUTONOMOUS machine-only canary task fixture', () => {
  const hostileTask = '- [ ] 7.7 在 `CANARY_ACTIVE` 讓 `activation_canary` 走machine-only REST merge。';

  assert.deepEqual(canaryDualGateErrors(hostileTask), [
    'pre_autonomy_machine_or_review_bypass',
    'canary_dual_gate_missing',
  ]);
  assert.deepEqual(machineOnlyPathErrors(hostileTask), [
    'machine_only_before_autonomous',
  ]);
});

test('Task 7 collector rejects counted-review retirement before AUTONOMOUS_ACTIVE', () => {
  const prematureRetirementTask = '- [ ] 7.7 在 `CANARY_ACTIVE` retire existing counted review before activation.';

  assert.deepEqual(activationRetirementErrors(prematureRetirementTask), [
    'pre_autonomy_counted_review_retirement',
    'retirement_guard_incomplete',
  ]);
});

test('ai-coding-governance delta modifies only canonical headings and adds the activation requirement', () => {
  const canonicalTitles = new Set(extractRequirementSections(read('openspec/specs/ai-coding-governance/spec.md')).map(({ title }) => title));
  const headings = deltaRequirementHeadings(read('openspec/changes/autonomous-linux-delivery/specs/ai-coding-governance/spec.md'));
  const activationTitle = 'Autonomous review activation SHALL preserve the live counted review until attested';
  const result = {
    invalidModified: headings.filter(({ kind, title }) => kind === 'MODIFIED' && !canonicalTitles.has(title)).map(({ title }) => title),
    activationKind: headings.find(({ title }) => title === activationTitle)?.kind,
    invalidAdded: headings.filter(({ kind, title }) => kind === 'ADDED' && canonicalTitles.has(title)).map(({ title }) => title),
  };

  assert.deepEqual(result, { invalidModified: [], activationKind: 'ADDED', invalidAdded: [] });
});

test('Task 1 checkbox grammar accepts x and X while rejecting typo, nested, and prose markers', () => {
  const ledger = taskLedgerFromText([
    '- [x] lower-case completion',
    '- [X] upper-case completion',
    '- [ ] pending work',
    '- [x]missing required whitespace',
    '- [ x] malformed marker',
    '  - [X] nested marker',
    'prose - [X] must not become a task',
    '- [y] unsupported marker',
  ].join('\n'));

  assert.deepEqual(ledger, { completed: 2, total: 3, unsupported: 5 });
});
