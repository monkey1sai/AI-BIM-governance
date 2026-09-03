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
  const clause = findClause(section.body,
    (value) => value.includes('terminal class') && /(?:only allow|SHALL只允許)/u.test(value),
    'closed terminal class');
  const encoded = clause.match(/terminal class\s+SHALL(?: only allow|只允許)\s+(.+)$/u);
  assert.ok(encoded, 'closed terminal class must expose its enum after its closed allow clause');
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

function activationAuthorityErrors(markdown, source) {
  const errors = [];
  const require = (pattern, code) => {
    if (!pattern.test(markdown)) errors.push(code);
  };
  require(/external (?:machine )?trust root|external trust-root/iu, 'external_trust_root_missing');
  require(/exact-head (?:machine gate|machine gates|path|merge)|exact tuple/iu, 'exact_head_authority_missing');
  require(/REST (?:endpoint|merge|CAS|compare-and-swap)/iu, 'rest_cas_missing');
  require(/(?:--admin|admin bypass|no-admin).*(?:bypass|forbid|禁)|不得.*(?:--admin|bypass)/iu, 'admin_bypass_guard_missing');
  require(/activation_canary/iu, 'activation_canary_missing');
  require(/activation_closure/iu, 'activation_closure_missing');
  require(/(?:exact(?:-commit)? delivery|exact delivery)/iu, 'exact_delivery_missing');
  require(/settings (?:reread|維持相等)|authoritative reread/iu, 'settings_reread_missing');
  require(/rollback|回滾/iu, 'rollback_missing');
  if (source === 'tasks') {
    require(/7\.7[^\n]*activation_canary[^\n]*machine-only REST merge[^\n]*exact delivery[^\n]*activation_closure/iu,
      'canary_task_incomplete');
    require(/7\.8[^\n]*REST CAS[^\n]*exact delivery[^\n]*DELIVERED[^\n]*settings reread[^\n]*AUTONOMOUS_ACTIVE[^\n]*rollback[^\n]*HELD/iu,
      'closure_task_incomplete');
  }
  return errors;
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
    .filter((value) => value.includes('direct_stack'))
    .flatMap(codeTokens);
  assert.deepEqual(capacityTokens, ['writer_cap', 'direct_stack', 'direct_stack', 'HELD'],
    'record-gated review authority must hold direct stack until activation');
  const inactiveScenario = scenario(activationRequirement, 'An inactive record cannot open direct_stack');
  assert.ok(clauses(inactiveScenario.body).some((value) => value.startsWith('- **THEN**') && value.includes('disjoint session writers') && value.includes('`direct_stack`')),
    'inactive record scenario must still hold direct_stack while admitting disjoint writers');
  const isolationRequirement = requirement(fabricSpec, 'Session admission shall isolate by branch, worktree, and touch-set');
  assert.ok(requirementProse(isolationRequirement).includes('Occupied writer-seat count SHALL NOT'),
    'session admission must not use writer count as a blocker');
  const sameBranchScenario = scenario(isolationRequirement, 'Same-branch writers cannot proceed in parallel');
  assert.ok(clauses(sameBranchScenario.body).some((value) => value.includes('BRANCH_CONTENTION')),
    'same-branch contention must remain a session blocker');

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
  const writerRule = lines(agents).find((line) => line.includes('並行 Writer 隔離原則'));
  assert.ok(writerRule?.includes('不以 writer 數量為 blocker') && writerRule.includes('獨立 sibling worktree') && writerRule.includes('touch-set') && writerRule.includes('direct_stack'),
    'live policy must allow disjoint writers and keep direct_stack activation-gated');

  const autonomousProposal = read('openspec/changes/autonomous-linux-delivery/proposal.md');
  const autonomousDesign = read('openspec/changes/autonomous-linux-delivery/design.md');
  const autonomousTasks = read('openspec/changes/autonomous-linux-delivery/tasks.md');
  const autonomousSpec = read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md');
  const reviewSpec = read('openspec/changes/autonomous-linux-delivery/specs/pull-request-review-agent/spec.md');
  const governanceSpec = read('openspec/changes/autonomous-linux-delivery/specs/ai-coding-governance/spec.md');

  const classificationRequirement = requirement(autonomousSpec, 'Every protected-branch PR SHALL belong to one closed machine-governed class');
  for (const expected of ['activation_canary', 'activation_closure', 'release_hotfix', 'exact tuple', 'fail closed']) {
    assert.ok(classificationRequirement.body.includes(expected), `closed classifier must retain ${expected}`);
  }
  const terminalRequirement = requirement(autonomousSpec, 'Delivery transaction SHALL use a closed phase, terminal-class and reason-code schema');
  assertExactEnum(terminalEnum(terminalRequirement), TERMINAL_CLASSES, 'external terminal classes');
  const terminalScenario = scenario(terminalRequirement, 'Internal reason被發布成未知terminal state');
  const terminalWhen = findClause(terminalScenario.body, (value) => value.startsWith('- **WHEN**'), 'terminal invalid WHEN');
  for (const internalReason of ['MERGE_OUTCOME_UNVERIFIED', 'MERGED_NOT_DELIVERED', 'DELIVERY_PENDING_FIXPOINT']) {
    assert.ok(codeTokens(terminalWhen).includes(internalReason), `${internalReason} must be rejected as an external terminal value`);
  }
  assert.ok(!terminalEnum(terminalRequirement).some((value) => value.includes('_')),
    'closed external terminal set must exclude internal reason codes');

  const autonomousActivation = requirement(autonomousSpec, 'Activation SHALL add and attest machine authority before removing human requirements');
  const activationPhases = codeTokens(requirementProse(autonomousActivation))
    .filter((token) => CANONICAL_PHASES.includes(token));
  assertExactEnum([...new Set(activationPhases)], CANONICAL_PHASES, 'active autonomous review phases');
  const autonomousActivationProse = requirementProse(autonomousActivation);
  for (const expected of ['settings lease', 'rollback snapshot', 'activation_canary', 'activation_closure', 'authoritative reread']) {
    assert.ok(autonomousActivationProse.includes(expected), `CUTOVER_ARMED must require ${expected}`);
  }
  assert.ok(reviewSpec.includes('Review Disposition Agent') && /exact[- ]head/iu.test(reviewSpec),
    'review projection must retain the exact-head Review Disposition Agent contract');
  assert.ok(governanceSpec.includes('machine') && governanceSpec.includes('exact-head'),
    'governance projection must retain exact-head machine authority');
  assert.ok(autonomousProposal.includes('external machine trust root')
      && autonomousDesign.includes('exact-head machine gate')
      && autonomousTasks.includes('activation_closure'),
    'autonomous-delivery delta must carry the landed machine-authority and activation-closure contract');

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
  assert.equal(fabricRow.subject_commit, '24aa54d5aedba8a5f0774a095215b9f26d21e198');
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
  assert.ok(phase0Section.includes('shadow 並不代表已啟用交付') && phase0Section.includes('不授權 `direct_stack`') && phase0Section.includes('同一 branch 競寫仍禁止'),
    'NOW must retain the shadow/non-live delivery boundary without a writer-count blocker');
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

test('activation sources independently bind external exact-head authority and rollback', () => {
  const activationTasks = headingSection(
    read('openspec/changes/autonomous-linux-delivery/tasks.md'),
    '## 7. Self-referential bootstrap 與一次性 activation',
  );
  const sourceErrors = {
    design: activationAuthorityErrors(read('openspec/changes/autonomous-linux-delivery/design.md'), 'design'),
    specification: activationAuthorityErrors(read('openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md'), 'specification'),
    tasks: activationAuthorityErrors(read('openspec/changes/autonomous-linux-delivery/tasks.md'), 'tasks'),
  };

  assert.deepEqual(sourceErrors, { design: [], specification: [], tasks: [] },
    'each activation source must independently preserve trust-root, exact-head CAS, closure, delivery, reread, and rollback semantics');
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

test('machine-only hostile fixture remains rejected before an authenticated activation path', () => {
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
