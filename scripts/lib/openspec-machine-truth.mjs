import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const STATUS = new Set(['active', 'deferred', 'held', 'completed', 'archived']);
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ALLOWED_TRANSITIONS = new Map([
  ['active', new Set(['active', 'deferred', 'held', 'completed'])],
  ['deferred', new Set(['deferred', 'active', 'held'])],
  ['held', new Set(['held', 'active', 'deferred', 'completed'])],
  ['completed', new Set(['completed', 'archived'])],
  ['archived', new Set(['archived'])],
]);
const LEDGER_KEYS = ['schema_version', 'changes'];
const CHANGE_KEYS = [
  'id',
  'status',
  'owner',
  'current_slice',
  'blocked_by',
  'last_verified',
  'task_ledger',
  'evidence_refs',
  'subject_commit',
  'archive_debt',
];

export class MachineTruthInputError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'MachineTruthInputError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field, message) {
  throw new MachineTruthInputError(code, field, message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, expected, field) {
  if (!isObject(value)) fail('schema_invalid', field, `${field} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail('schema_invalid', field, `${field} has missing or unknown properties.`);
  }
}

function boundedJsonFile(filePath, label, maxBytes = 2 * 1024 * 1024) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink()) {
    fail('artifact_untrusted', label, `${label} must be a regular, non-link file.`);
  }
  if (item.size > maxBytes) fail('artifact_too_large', label, `${label} exceeds the size limit.`);
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath));
  try {
    return JSON.parse(raw);
  } catch {
    fail('artifact_invalid_json', label, `${label} is not valid JSON.`);
  }
}

function validateLedgerShape(ledger, label = 'ledger') {
  assertExactKeys(ledger, LEDGER_KEYS, label);
  if (ledger.schema_version !== 'openspec-lifecycle-ledger/v1') {
    fail('schema_invalid', `${label}.schema_version`, 'Unsupported lifecycle ledger schema version.');
  }
  if (!Array.isArray(ledger.changes) || ledger.changes.length > 500) {
    fail('schema_invalid', `${label}.changes`, 'changes must be a bounded array.');
  }
  const ids = new Set();
  for (const [index, change] of ledger.changes.entries()) {
    const field = `${label}.changes[${index}]`;
    assertExactKeys(change, CHANGE_KEYS, field);
    if (typeof change.id !== 'string' || !CHANGE_ID.test(change.id) || ids.has(change.id)) {
      fail('schema_invalid', `${field}.id`, 'Change id is invalid or duplicated.');
    }
    ids.add(change.id);
    if (!STATUS.has(change.status)) fail('schema_invalid', `${field}.status`, 'Lifecycle status is unknown.');
    if (typeof change.owner !== 'string' || !change.owner.trim() || change.owner.length > 200) {
      fail('schema_invalid', `${field}.owner`, 'Owner is required.');
    }
    if (change.current_slice !== null &&
        (typeof change.current_slice !== 'string' || !change.current_slice.trim() || change.current_slice.length > 500)) {
      fail('schema_invalid', `${field}.current_slice`, 'current_slice must be null or non-empty text.');
    }
    if (change.status === 'active' && change.current_slice === null) {
      fail('schema_invalid', `${field}.current_slice`, 'Active changes require a current slice.');
    }
    if (!Array.isArray(change.blocked_by) || change.blocked_by.length > 100 ||
        change.blocked_by.some((id) => typeof id !== 'string' || !CHANGE_ID.test(id)) ||
        new Set(change.blocked_by).size !== change.blocked_by.length) {
      fail('schema_invalid', `${field}.blocked_by`, 'blocked_by is invalid.');
    }
    if (typeof change.last_verified !== 'string' || !TIMESTAMP.test(change.last_verified) ||
        Number.isNaN(Date.parse(change.last_verified))) {
      fail('schema_invalid', `${field}.last_verified`, 'last_verified is invalid.');
    }
    assertExactKeys(change.task_ledger, ['completed', 'total'], `${field}.task_ledger`);
    const { completed, total } = change.task_ledger;
    if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 0 ||
        completed > total || total > 1_000_000) {
      fail('schema_invalid', `${field}.task_ledger`, 'Task counts are invalid.');
    }
    if (!Array.isArray(change.evidence_refs) || change.evidence_refs.length === 0 ||
        change.evidence_refs.length > 200 ||
        change.evidence_refs.some((ref) => typeof ref !== 'string' || !ref.trim() || ref.length > 500) ||
        new Set(change.evidence_refs).size !== change.evidence_refs.length) {
      fail('schema_invalid', `${field}.evidence_refs`, 'At least one unique evidence reference is required.');
    }
    if (typeof change.subject_commit !== 'string' || !COMMIT.test(change.subject_commit)) {
      fail('schema_invalid', `${field}.subject_commit`, 'subject_commit must be a lowercase full SHA.');
    }
    if (change.archive_debt !== null) {
      assertExactKeys(change.archive_debt, ['reason', 'unchecked_tasks', 'unsupported_checkboxes', 'owner', 'review_due'], `${field}.archive_debt`);
      if (change.status !== 'archived' || change.archive_debt.reason !== 'historical_task_ledger_debt' ||
          !Number.isInteger(change.archive_debt.unchecked_tasks) || change.archive_debt.unchecked_tasks < 0 ||
          !Number.isInteger(change.archive_debt.unsupported_checkboxes) || change.archive_debt.unsupported_checkboxes < 0 ||
          change.archive_debt.unchecked_tasks + change.archive_debt.unsupported_checkboxes < 1 ||
          typeof change.archive_debt.owner !== 'string' || !change.archive_debt.owner.trim() ||
          typeof change.archive_debt.review_due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(change.archive_debt.review_due)) {
        fail('schema_invalid', `${field}.archive_debt`, 'archive_debt must be a typed exception on an archived change.');
      }
    }
  }
  return new Map(ledger.changes.map((change) => [change.id, change]));
}

export function validateOpenSpecLifecycleLedger(ledger) {
  validateLedgerShape(ledger);
  return ledger;
}

function assertRepositoryPath(repoRoot, candidatePath, field, expectedType) {
  const root = realpathSync(repoRoot);
  const candidate = path.resolve(candidatePath);
  const prefix = `${root}${path.sep}`;
  const comparison = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const rootComparison = process.platform === 'win32' ? prefix.toLowerCase() : prefix;
  if (!comparison.startsWith(rootComparison)) {
    fail('artifact_untrusted', field, 'Repository input escapes the trusted root.');
  }
  let cursor = root;
  for (const segment of path.relative(root, candidate).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const item = lstatSync(cursor);
    if (item.isSymbolicLink()) {
      fail('artifact_untrusted', field, 'Repository input contains a link or reparse component.');
    }
  }
  const item = lstatSync(candidate);
  if ((expectedType === 'file' && !item.isFile()) || (expectedType === 'directory' && !item.isDirectory())) {
    fail('artifact_untrusted', field, `Repository input must be a regular ${expectedType}.`);
  }
  const real = realpathSync(candidate);
  const realComparison = process.platform === 'win32' ? real.toLowerCase() : real;
  if (!realComparison.startsWith(rootComparison)) {
    fail('artifact_untrusted', field, 'Repository input resolves outside the trusted root.');
  }
  return real;
}

function safeRepositoryFile(repoRoot, reference, field) {
  if (path.isAbsolute(reference) || reference.includes('\0')) {
    fail('artifact_untrusted', field, 'Evidence references must be repository-relative.');
  }
  const candidate = path.resolve(repoRoot, reference);
  const rootPrefix = `${path.resolve(repoRoot)}${path.sep}`;
  const candidateKey = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
  const prefixKey = process.platform === 'win32' ? rootPrefix.toLowerCase() : rootPrefix;
  if (!candidateKey.startsWith(prefixKey)) {
    fail('artifact_untrusted', field, 'Evidence reference escapes the repository.');
  }
  try {
    lstatSync(candidate);
  } catch {
    return { exists: false, path: candidate };
  }
  const real = assertRepositoryPath(repoRoot, candidate, field, 'file');
  return { exists: true, path: real };
}

export function taskLedgerFromText(text) {
  let completed = 0;
  let total = 0;
  let unsupported = 0;
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*-\s+\[([^\]])\]/u);
    if (!match) continue;
    if (match[1] === 'x' || match[1] === 'X') {
      completed += 1;
      total += 1;
    } else if (match[1] === ' ') {
      total += 1;
    } else {
      unsupported += 1;
    }
  }
  return { completed, total, unsupported };
}

function validateBaselineArchiveTasks(value) {
  if (value === null) return new Map();
  if (!isObject(value) || Object.keys(value).length > 500) {
    fail('source_observation_invalid', 'baseline_archive_tasks', 'Baseline archive task observations are invalid.');
  }
  const result = new Map();
  for (const [id, observed] of Object.entries(value)) {
    if (!CHANGE_ID.test(id) || !isObject(observed)) {
      fail('source_observation_invalid', 'baseline_archive_tasks', 'Baseline archive task observations are invalid.');
    }
    assertExactKeys(observed, ['completed', 'total', 'unsupported'], `baseline_archive_tasks.${id}`);
    if (![observed.completed, observed.total, observed.unsupported].every(Number.isInteger) ||
        observed.completed < 0 || observed.total < observed.completed || observed.unsupported < 0) {
      fail('source_observation_invalid', `baseline_archive_tasks.${id}`, 'Baseline archive task counts are invalid.');
    }
    result.set(id, observed);
  }
  return result;
}

function proposalStatus(text) {
  const prologue = text.split(/\r?\n/u).slice(0, 40).join('\n');
  const matches = [...prologue.matchAll(/^>\s*\*\*Status:\s*([a-z-]+)/gimu)].map((match) => match[1].toLowerCase());
  if (matches.length > 1) return 'invalid';
  if (matches.length === 0) return 'active';
  if (matches[0] === 'adopted') return 'completed';
  return STATUS.has(matches[0]) ? matches[0] : 'invalid';
}

function parseNow(text) {
  const start = '<!-- lifecycle-ledger:start -->';
  const end = '<!-- lifecycle-ledger:end -->';
  if (text.split(start).length !== 2 || text.split(end).length !== 2) {
    fail('now_view_invalid', 'now', 'NOW.md must contain exactly one lifecycle projection block.');
  }
  const body = text.slice(text.indexOf(start) + start.length, text.indexOf(end)).trim();
  const match = body.match(/^```json\s*([\s\S]*?)\s*```$/u);
  if (!match) fail('now_view_invalid', 'now', 'NOW.md lifecycle projection must be fenced JSON.');
  try {
    return JSON.parse(match[1]);
  } catch {
    fail('now_view_invalid', 'now', 'NOW.md lifecycle projection is invalid JSON.');
  }
}

function mismatch(list, code, reason, changeId, field, expectedSource, expected, actualSource, actual, message) {
  list.push({
    code,
    reason,
    change_id: changeId,
    field,
    expected_source: expectedSource,
    expected: expected === null ? null : String(expected),
    actual_source: actualSource,
    actual: actual === null ? null : String(actual),
    message,
  });
}

function currentLedger(ledgerById) {
  return new Map([...ledgerById].filter(([, change]) => change.status !== 'archived'));
}

function compareNowProjection(document, ledgerById, mismatches) {
  assertExactKeys(document, ['schema_version', 'scope', 'changes'], 'now');
  if (document.schema_version !== 'openspec-now-view/v1' || document.scope !== 'current' ||
      !Array.isArray(document.changes)) {
    fail('schema_invalid', 'now', 'NOW projection must use the bounded current-scope schema.');
  }
  const expectedById = currentLedger(ledgerById);
  const seen = new Set();
  for (const [index, item] of document.changes.entries()) {
    assertExactKeys(item, ['id', 'status'], `now.changes[${index}]`);
    if (typeof item.id !== 'string' || !CHANGE_ID.test(item.id) || seen.has(item.id) || !STATUS.has(item.status)) {
      fail('schema_invalid', `now.changes[${index}]`, 'NOW contains an invalid or duplicate change.');
    }
    seen.add(item.id);
    const ledger = expectedById.get(item.id);
    if (!ledger) {
      mismatch(mismatches, 'projection', 'unexpected_change', item.id, 'now.changes',
        'machine_ledger.current', 'absent', 'now', 'present', 'NOW contains a non-current or unknown change.');
    } else if (ledger.status !== item.status) {
      mismatch(mismatches, 'projection', 'lifecycle_disagreement', item.id, 'now.status',
        'machine_ledger', ledger.status, 'now', item.status, 'NOW lifecycle disagrees with the machine ledger.');
    }
  }
  for (const id of expectedById.keys()) {
    if (!seen.has(id)) {
      mismatch(mismatches, 'projection', 'change_missing', id, 'now.changes', 'machine_ledger.current',
        'present', 'now', 'missing', 'NOW is missing a current machine-ledger change.');
    }
  }
}

function compareGitHubObservation(document, ledgerById, subjectCommit, mismatches) {
  assertExactKeys(document, ['schema_version', 'scope', 'repository_subject', 'changes'], 'github');
  if (document.schema_version !== 'openspec-github-lifecycle-state/v1' || document.scope !== 'current' ||
      !Array.isArray(document.changes) || typeof document.repository_subject !== 'string' ||
      !COMMIT.test(document.repository_subject)) {
    fail('schema_invalid', 'github', 'GitHub input must be a raw current-scope observation.');
  }
  if (document.repository_subject !== subjectCommit) {
    mismatch(mismatches, 'subject', 'subject_mismatch', null, 'github.repository_subject', 'trusted_subject',
      subjectCommit, 'github', document.repository_subject, 'GitHub observation belongs to another repository subject.');
  }
  const expectedById = currentLedger(ledgerById);
  const seen = new Set();
  const seenPrs = new Set();
  for (const [index, item] of document.changes.entries()) {
    assertExactKeys(item, ['id', 'prs'], `github.changes[${index}]`);
    if (typeof item.id !== 'string' || !CHANGE_ID.test(item.id) || seen.has(item.id) || !Array.isArray(item.prs) ||
        item.prs.length > 100) {
      fail('schema_invalid', `github.changes[${index}]`, 'GitHub observation contains an invalid or duplicate change.');
    }
    seen.add(item.id);
    for (const [prIndex, pr] of item.prs.entries()) {
      assertExactKeys(pr, ['number', 'state', 'head_sha'], `github.changes[${index}].prs[${prIndex}]`);
      if (!Number.isInteger(pr.number) || pr.number < 1 || !['open', 'closed', 'merged'].includes(pr.state) ||
          typeof pr.head_sha !== 'string' || !COMMIT.test(pr.head_sha)) {
        fail('schema_invalid', `github.changes[${index}].prs[${prIndex}]`, 'GitHub PR observation is invalid.');
      }
      if (seenPrs.has(pr.number)) {
        mismatch(mismatches, 'github', 'pr_duplicate', item.id, 'github.prs.number', 'github_contract',
          'unique mapping', 'github', pr.number, 'A PR number is mapped to more than one change.');
      }
      seenPrs.add(pr.number);
    }
    if (!expectedById.has(item.id)) {
      mismatch(mismatches, 'github', 'unexpected_change', item.id, 'github.changes', 'machine_ledger.current',
        'absent', 'github', 'present', 'GitHub input contains a non-current or unknown change.');
    }
  }
  for (const id of expectedById.keys()) {
    if (!seen.has(id)) {
      mismatch(mismatches, 'github', 'change_missing', id, 'github.changes', 'machine_ledger.current',
        'present', 'github', 'missing', 'GitHub input is missing a current machine-ledger change.');
    }
  }
}

function validateBlockers(ledgerById, mismatches) {
  for (const change of ledgerById.values()) {
    for (const blocker of change.blocked_by) {
      if (!ledgerById.has(blocker)) {
        mismatch(mismatches, 'blocker_graph', 'blocker_missing', change.id, 'blocked_by',
          'machine_ledger', 'existing change id', 'machine_ledger', blocker, 'blocked_by references an unknown change.');
      }
    }
  }
  const state = new Map();
  const visit = (id, stack) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const cycle = [...stack.slice(stack.indexOf(id)), id].join(' -> ');
      mismatch(mismatches, 'blocker_graph', 'cycle_detected', id, 'blocked_by',
        'acyclic_graph', 'acyclic', 'machine_ledger', cycle, 'blocked_by contains a cycle.');
      return;
    }
    state.set(id, 1);
    const change = ledgerById.get(id);
    for (const blocker of change.blocked_by) if (ledgerById.has(blocker)) visit(blocker, [...stack, id]);
    state.set(id, 2);
  };
  for (const id of ledgerById.keys()) visit(id, []);
}

function comparePrevious(previousById, currentById, mismatches) {
  for (const [id, before] of previousById) {
    const after = currentById.get(id);
    if (!after) {
      mismatch(mismatches, 'transition', 'change_removed', id, 'status', 'previous_ledger', before.status,
        'machine_ledger', 'missing', 'A lifecycle entry cannot disappear; retain it as archived.');
      continue;
    }
    if (!ALLOWED_TRANSITIONS.get(before.status).has(after.status)) {
      mismatch(mismatches, 'transition', 'transition_invalid', id, 'status', 'allowed_transition',
        [...ALLOWED_TRANSITIONS.get(before.status)].join('|'), 'machine_ledger', `${before.status}->${after.status}`,
        'Lifecycle transition is not allowed.');
    }
  }
  for (const [id, after] of currentById) {
    if (!previousById.has(id) && ['completed', 'archived'].includes(after.status)) {
      mismatch(mismatches, 'transition', 'terminal_change_added', id, 'status', 'transition_contract',
        'active|deferred|held', 'machine_ledger', after.status, 'A new change cannot begin in a terminal state.');
    }
  }
}

function repositoryInventory(repoRoot) {
  const changesRoot = path.join(repoRoot, 'openspec', 'changes');
  const archiveRoot = path.join(changesRoot, 'archive');
  assertRepositoryPath(repoRoot, changesRoot, 'openspec.changes', 'directory');
  assertRepositoryPath(repoRoot, archiveRoot, 'openspec.archive', 'directory');
  const active = new Map();
  const archive = new Map();
  const duplicateArchiveIds = new Set();
  for (const entry of readdirSync(changesRoot, { withFileTypes: true })) {
    if (entry.name === 'archive') continue;
    if (entry.isSymbolicLink()) fail('artifact_untrusted', 'openspec.changes', 'Active changes cannot be links.');
    if (!entry.isDirectory()) continue;
    const directory = path.join(changesRoot, entry.name);
    assertRepositoryPath(repoRoot, directory, `openspec.changes.${entry.name}`, 'directory');
    active.set(entry.name, directory);
  }
  for (const entry of readdirSync(archiveRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail('artifact_untrusted', 'openspec.archive', 'Archived changes cannot be links.');
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/u);
    if (!match || !CHANGE_ID.test(match[1])) {
      fail('archive_identity_invalid', 'openspec.archive', 'Archive directory does not encode a valid dated change id.');
    }
    const directory = path.join(archiveRoot, entry.name);
    assertRepositoryPath(repoRoot, directory, `openspec.archive.${entry.name}`, 'directory');
    if (archive.has(match[1])) duplicateArchiveIds.add(match[1]);
    else archive.set(match[1], { directory, directoryName: entry.name });
  }
  return { active, archive, duplicateArchiveIds };
}

function readTrustedText(repoRoot, filePath, label, maxBytes = 2 * 1024 * 1024) {
  const trustedPath = assertRepositoryPath(repoRoot, filePath, label, 'file');
  const item = lstatSync(trustedPath);
  if (item.size > maxBytes) {
    fail('artifact_untrusted', label, `${label} is not a bounded regular file.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(trustedPath));
}

export function evaluateOpenSpecMachineTruth({
  repoRoot,
  ledger,
  nowText,
  githubState,
  openSpecList,
  previousLedger = null,
  baselineArchiveTasks = null,
  subjectCommit,
  sourceChangedPaths = [],
  wipLimit = 6,
}) {
  if (typeof subjectCommit !== 'string' || !COMMIT.test(subjectCommit)) {
    fail('subject_invalid', 'subject_commit', 'A lowercase full trusted subject SHA is required.');
  }
  const ledgerById = validateLedgerShape(ledger);
  const previousById = previousLedger === null ? null : validateLedgerShape(previousLedger, 'previous_ledger');
  const baselineArchiveById = validateBaselineArchiveTasks(baselineArchiveTasks);
  const mismatches = [];
  if (!Array.isArray(sourceChangedPaths) || sourceChangedPaths.some((value) => typeof value !== 'string')) {
    fail('source_observation_invalid', 'source_changed_paths', 'Source-at-subject observation is invalid.');
  }
  const changedSources = new Set(sourceChangedPaths.map((value) => value.replaceAll('\\', '/')));
  for (const change of ledgerById.values()) {
    if (change.subject_commit !== subjectCommit) {
      mismatch(mismatches, 'subject', 'subject_mismatch', change.id, 'subject_commit', 'trusted_subject',
        subjectCommit, 'machine_ledger', change.subject_commit, 'Machine state is stale or belongs to another subject.');
    }
  }
  validateBlockers(ledgerById, mismatches);
  if (previousById) comparePrevious(previousById, ledgerById, mismatches);

  const activeCount = [...ledgerById.values()].filter((change) => change.status === 'active').length;
  if (activeCount > wipLimit) {
    mismatch(mismatches, 'wip', 'budget_exceeded', null, 'changes.status', 'wip_policy', wipLimit,
      'machine_ledger', activeCount, 'Active lifecycle WIP exceeds the configured budget.');
  }

  const inventory = repositoryInventory(repoRoot);
  let acceptedArchiveDebtCount = 0;
  for (const duplicateId of inventory.duplicateArchiveIds) {
    mismatch(mismatches, 'archive', 'archive_identity_duplicate', duplicateId, 'repository.archive',
      'archive_contract', 'unique change identity', 'repository', 'duplicate', 'Archive identity is duplicated.');
  }
  for (const id of inventory.active.keys()) {
    if (!ledgerById.has(id)) {
      mismatch(mismatches, 'presence', 'machine_state_missing', id, 'machine_ledger', 'repository', 'present',
        'machine_ledger', 'missing', 'An active repository change has no machine lifecycle state.');
    }
  }
  for (const id of inventory.archive.keys()) {
    const ledger = ledgerById.get(id);
    if (!ledger || ledger.status !== 'archived') {
      mismatch(mismatches, 'archive', 'archive_entry_untracked', id, 'machine_ledger', 'repository.archive',
        'archived', 'machine_ledger', ledger?.status ?? 'missing', 'Archive history has no archived machine-ledger row.');
    }
  }
  for (const changedPath of changedSources) {
    if (!changedPath.startsWith('openspec/changes/')) continue;
    const archiveMatch = changedPath.match(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-([^/]+)\//u);
    const activeMatch = changedPath.match(/^openspec\/changes\/([^/]+)\//u);
    const id = archiveMatch?.[1] ?? (activeMatch?.[1] === 'archive' ? null : activeMatch?.[1]) ?? null;
    mismatch(mismatches, 'subject', 'source_changed_since_subject', id, changedPath, 'trusted_subject',
      'unchanged source', 'worktree', 'changed', 'OpenSpec source differs from the trusted observed snapshot.');
  }
  for (const change of ledgerById.values()) {
    const activePath = inventory.active.get(change.id);
    const archiveRecord = inventory.archive.get(change.id);
    const archivePath = archiveRecord?.directory;
    if (activePath && archiveRecord) {
      mismatch(mismatches, 'archive', 'duplicate_active_archive', change.id, 'repository.location',
        'lifecycle_contract', 'one location', 'repository', 'active+archive', 'Change exists in active and archive locations.');
    }
    const expectedArchived = change.status === 'archived';
    const directory = expectedArchived ? archivePath : activePath;
    if (!directory) {
      mismatch(mismatches, 'presence', 'directory_missing', change.id, 'repository.location',
        'machine_ledger', expectedArchived ? 'archive' : 'active', 'repository', 'missing',
        'Machine lifecycle state has no matching repository directory.');
      continue;
    }
    if (!expectedArchived && archiveRecord) {
      mismatch(mismatches, 'archive', 'archive_history_conflict', change.id, 'repository.location',
        'machine_ledger', 'active', 'archive_history', 'archived', 'Current and archive lifecycle history disagree.');
    }
    const proposalPath = path.join(directory, 'proposal.md');
    const tasksPath = path.join(directory, 'tasks.md');
    let proposalText;
    let tasksText;
    try { proposalText = readTrustedText(repoRoot, proposalPath, `${change.id}.proposal`); } catch (error) {
      if (error instanceof MachineTruthInputError) throw error;
      mismatch(mismatches, 'presence', 'proposal_missing', change.id, 'proposal.md', 'repository_contract',
        'present', 'repository', 'missing', 'proposal.md is required.');
    }
    try { tasksText = readTrustedText(repoRoot, tasksPath, `${change.id}.tasks`); } catch (error) {
      if (error instanceof MachineTruthInputError) throw error;
      mismatch(mismatches, 'presence', 'tasks_missing', change.id, 'tasks.md', 'repository_contract',
        'present', 'repository', 'missing', 'tasks.md is required.');
    }
    if (proposalText !== undefined) {
      const observed = proposalStatus(proposalText);
      const compatible = expectedArchived
        ? !['deferred', 'held', 'invalid'].includes(observed)
        : change.status === observed || (change.status === 'active' && observed === 'active');
      if (!compatible) {
        mismatch(mismatches, 'lifecycle', observed === 'invalid' ? 'invalid_marker' : 'lifecycle_disagreement',
          change.id, 'proposal.status', 'machine_ledger', change.status, 'proposal', observed,
          'Proposal lifecycle marker disagrees with the machine ledger.');
      }
    }
    if (tasksText !== undefined) {
      const observed = taskLedgerFromText(tasksText);
      if (observed.unsupported > 0 && !expectedArchived) {
        mismatch(mismatches, 'task_ledger', 'unsupported_checkbox', change.id, 'task_ledger',
          'task_contract', '[ ]|[x]', 'tasks.md', observed.unsupported, 'tasks.md has unsupported checkbox markers.');
      }
      for (const field of ['completed', 'total']) {
        if (observed[field] !== change.task_ledger[field]) {
          mismatch(mismatches, 'task_ledger', `${field}_mismatch`, change.id, `task_ledger.${field}`,
            'machine_ledger', change.task_ledger[field], 'tasks.md', observed[field], 'Task counts disagree.');
        }
      }
      if (expectedArchived && (observed.completed !== observed.total || observed.unsupported > 0)) {
        const debt = change.archive_debt;
        if (debt === null || debt.unchecked_tasks !== observed.total - observed.completed ||
            debt.unsupported_checkboxes !== observed.unsupported) {
          mismatch(mismatches, 'archive', 'archive_incomplete', change.id, 'archive_debt', 'archive_contract',
            `typed debt unchecked=${observed.total - observed.completed};unsupported=${observed.unsupported}`,
            'machine_ledger', debt === null ? 'missing' :
              `unchecked=${debt.unchecked_tasks};unsupported=${debt.unsupported_checkboxes}`,
            'Archived task debt is absent or stale.');
        } else {
          const prior = previousById?.get(change.id);
          const inheritedDebt = prior?.status === 'archived' && prior.archive_debt !== null &&
            JSON.stringify(prior.archive_debt) === JSON.stringify(debt);
          const baseline = baselineArchiveById.get(change.id);
          const bootstrapDebt = previousById === null && baseline !== undefined &&
            baseline.completed === observed.completed && baseline.total === observed.total &&
            baseline.unsupported === observed.unsupported;
          if (!inheritedDebt && !bootstrapDebt) {
            mismatch(mismatches, 'archive', 'archive_debt_unproven', change.id, 'archive_debt',
              'trusted_subject', 'pre-existing archived debt', 'machine_ledger', 'new_or_changed',
              'Archive debt must be inherited from the previous ledger or observed in archive tasks at the trusted subject.');
          } else {
            acceptedArchiveDebtCount += 1;
          }
        }
      } else if (expectedArchived && change.archive_debt !== null) {
        mismatch(mismatches, 'archive', 'archive_debt_stale', change.id, 'archive_debt', 'tasks.md',
          'null', 'machine_ledger', change.archive_debt.unchecked_tasks, 'Archive debt remains after all tasks are complete.');
      }
    }
    const evidencePrefix = expectedArchived
      ? path.posix.join('openspec/changes/archive', archiveRecord.directoryName)
      : path.posix.join('openspec/changes', change.id);
    const requiredEvidence = [
      path.posix.join(evidencePrefix, 'proposal.md'),
      path.posix.join(evidencePrefix, 'tasks.md'),
    ];
    for (const required of requiredEvidence) {
      if (!change.evidence_refs.map((ref) => ref.replaceAll('\\', '/')).includes(required)) {
        mismatch(mismatches, 'evidence', 'required_evidence_missing', change.id, 'evidence_refs',
          'evidence_contract', required, 'machine_ledger', 'missing', 'Required lifecycle evidence is not referenced.');
      }
    }
    for (const [index, reference] of change.evidence_refs.entries()) {
      const normalizedReference = reference.replaceAll('\\', '/');
      const observed = safeRepositoryFile(repoRoot, reference, `changes.${change.id}.evidence_refs[${index}]`);
      if (!observed.exists) {
        mismatch(mismatches, 'evidence', 'evidence_target_missing', change.id, `evidence_refs[${index}]`,
          'machine_ledger', 'existing repository file', 'repository', 'missing', 'Evidence reference does not exist.');
      }
      if (changedSources.has(normalizedReference)) {
        mismatch(mismatches, 'subject', 'evidence_changed_since_subject', change.id, `evidence_refs[${index}]`,
          'trusted_subject', 'unchanged evidence', 'worktree', 'changed', 'Evidence differs from the trusted observed snapshot.');
      }
    }
  }

  const now = typeof nowText === 'string' ? parseNow(nowText) : nowText;
  compareNowProjection(now, ledgerById, mismatches);
  compareGitHubObservation(githubState, ledgerById, subjectCommit, mismatches);

  if (!isObject(openSpecList) || !Array.isArray(openSpecList.changes)) {
    fail('schema_invalid', 'openspec_list', 'OpenSpec list observation is invalid.');
  }
  const openSpecById = new Map();
  for (const item of openSpecList.changes) {
    if (!isObject(item) || typeof item.name !== 'string' || !CHANGE_ID.test(item.name) || openSpecById.has(item.name) ||
        !Number.isInteger(item.completedTasks) || !Number.isInteger(item.totalTasks)) {
      fail('schema_invalid', 'openspec_list.changes', 'OpenSpec list contains an invalid or duplicate change.');
    }
    openSpecById.set(item.name, item);
  }
  for (const [id, change] of ledgerById) {
    if (change.status === 'archived') continue;
    const observed = openSpecById.get(id);
    if (!observed) {
      mismatch(mismatches, 'presence', 'openspec_entry_missing', id, 'openspec_list.changes',
        'machine_ledger', 'present', 'openspec_cli', 'missing', 'OpenSpec CLI is missing a current change.');
      continue;
    }
    for (const field of ['completed', 'total']) {
      const observedKey = field === 'completed' ? 'completedTasks' : 'totalTasks';
      if (observed[observedKey] !== change.task_ledger[field]) {
        mismatch(mismatches, 'task_ledger', `${field}_mismatch`, id, `task_ledger.${field}`,
          'machine_ledger', change.task_ledger[field], 'openspec_cli', observed[observedKey], 'OpenSpec task counts disagree.');
      }
    }
    const compatibleStatus = ['active', 'deferred', 'held'].includes(change.status)
      ? ['in-progress', 'no-tasks'].includes(observed.status)
      : change.status === 'completed' && observed.status === 'complete';
    if (!compatibleStatus) {
      mismatch(mismatches, 'lifecycle', 'openspec_status_disagreement', id, 'openspec_list.status',
        'machine_ledger', change.status, 'openspec_cli', observed.status ?? null, 'OpenSpec task state disagrees with lifecycle state.');
    }
  }
  for (const id of openSpecById.keys()) {
    if (!ledgerById.has(id)) {
      mismatch(mismatches, 'presence', 'machine_state_missing', id, 'machine_ledger', 'openspec_cli', 'present',
        'machine_ledger', 'missing', 'OpenSpec CLI reports a change absent from the machine ledger.');
    }
  }

  mismatches.sort((a, b) =>
    `${a.change_id ?? ''}\0${a.code}\0${a.field}\0${a.reason}`.localeCompare(
      `${b.change_id ?? ''}\0${b.code}\0${b.field}\0${b.reason}`, 'en'));
  return {
    schema_version: 'openspec-machine-truth-report/v1',
    result: mismatches.length === 0
      ? (acceptedArchiveDebtCount > 0 ? 'consistent_with_accepted_debt' : 'consistent')
      : 'mismatch',
    subject_commit: subjectCommit,
    sources: {
      ledger: 'openspec/lifecycle-ledger.json',
      now: 'docs/plans/NOW.md#lifecycle-ledger',
      github: 'read-only-input',
      openspec: 'openspec-list-json',
      previous_ledger: previousLedger === null ? 'not_provided' : 'provided',
    },
    summary: {
      change_count: ledgerById.size,
      active_count: activeCount,
      archive_count: inventory.archive.size,
      archive_debt_count: acceptedArchiveDebtCount,
      mismatch_count: mismatches.length,
    },
    mismatches,
    errors: [],
  };
}

export function loadOpenSpecMachineTruthInputs({ ledgerPath, githubPath, openSpecPath, previousLedgerPath }) {
  return {
    ledger: boundedJsonFile(ledgerPath, 'ledger'),
    githubState: boundedJsonFile(githubPath, 'github_state'),
    openSpecList: boundedJsonFile(openSpecPath, 'openspec_list'),
    previousLedger: previousLedgerPath ? boundedJsonFile(previousLedgerPath, 'previous_ledger') : null,
  };
}
