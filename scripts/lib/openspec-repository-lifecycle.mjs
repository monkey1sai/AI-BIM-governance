// scripts/lib/openspec-repository-lifecycle.mjs
// Repository-scoped OpenSpec lifecycle parity.
//
// Why this module exists (the hole it closes):
//   scripts/lib/openspec-machine-truth.mjs already owns a complete lifecycle comparator,
//   but its CLI (scripts/tests/verify-openspec-machine-truth.mjs) requires a GitHub
//   observation and an `openspec list --json` capture. Both need network access and a
//   pinned external binary, so CI only ever exercises that comparator against synthetic
//   temporary fixtures. The single assertion that touches the real repository is a
//   hand-written regex for one change id. Everything else -- the current rows and the
//   archived rows -- is unguarded, which is why projection/ledger drift has repeatedly
//   been corrected by hand after the fact instead of being refused at PR time.
//
// This module deliberately covers only the subset of lifecycle truth that is entirely
// repository-local, and is therefore cheap enough to gate on every pull request:
//
//   1. openspec/changes/<id>/ directories + their `> **Status:` proposal markers
//   2. openspec/lifecycle-ledger.json                         (the machine ledger)
//   3. the docs/plans/NOW.md lifecycle projection             (the human-facing view)
//
// No network, no git, no external binary, no clock.
//
// Deliberate scope boundaries (each already owned by an existing required gate, so this
// module does not duplicate them):
//   - archived proposal markers -> scripts/tests/verify-openspec-lifecycle.ps1 refuses a
//     deferred marker stored in the completed archive.
//   - task-ledger counts, evidence refs, subject-commit freshness and GitHub PR state ->
//     scripts/lib/openspec-machine-truth.mjs.
//   - the WIP budget -> scripts/tests/verify-openspec-lifecycle.ps1.
//
// The status vocabulary and the proposal-marker parse are a deliberate mirror of
// openspec-machine-truth.mjs rather than an import: that file is classified as
// self-referential mechanism surface by docs/agents/self-referential-bootstrap.md, so
// importing it would drag this change onto the mechanism surface and open bootstrap debt
// for a read-only helper. The mirror is pinned by tests.
//
// Failure discipline: an input this module cannot read AS DECLARED is an input error
// (the gate refuses to judge). A tree it can read but whose sources disagree is a
// mismatch (the gate refuses the tree, naming the disagreement). Anything an author can
// legitimately write is a mismatch, never an input error -- otherwise one odd file would
// take the whole required check down instead of pointing at the row that is wrong.

import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const REPORT_SCHEMA_VERSION = 'openspec-repository-lifecycle-report/v1';
export const LEDGER_SCHEMA_VERSION = 'openspec-lifecycle-ledger/v1';
export const NOW_SCHEMA_VERSION = 'openspec-now-view/v1';

// Kept identical to the CHANGE_ID and STATUS contracts in openspec-machine-truth.mjs so
// the two comparators cannot disagree about which ids and states are canonical. Narrowing
// either set here would turn a legitimate row into an input error that takes the whole
// gate down instead of reporting one targeted mismatch.
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const ARCHIVE_DIRECTORY = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9][a-z0-9-]{0,127})$/u;
const STATUS = new Set(['active', 'deferred', 'held', 'completed', 'archived']);

// Sentinels for a proposal the marker parse refuses to guess at.
const PROPOSAL_ABSENT = null;
const PROPOSAL_UNREADABLE_FILE = 'unreadable-file';
const MARKER_NEAR_MISS = 'near-miss';
const MARKER_INVALID = 'invalid';

// Bounds keep a malformed or hostile tree from turning the gate into a denial of service.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CURRENT_CHANGES = 512;
const MAX_ARCHIVE_DIRECTORIES = 4096;
const MAX_LEDGER_ROWS = 8192;
const PROLOGUE_LINES = 40;

const NOW_START = '<!-- lifecycle-ledger:start -->';
const NOW_END = '<!-- lifecycle-ledger:end -->';
const FENCE_OPEN = '```json';
const FENCE_CLOSE = '```';

export class RepositoryLifecycleInputError extends Error {
  constructor(code, field, message) {
    super(message);
    this.name = 'RepositoryLifecycleInputError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, field, message) {
  throw new RepositoryLifecycleInputError(code, field, message);
}

function lstatOrNull(target) {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Canonicalises the repository root. A checkout legitimately reached through a junction
 * or symlink (this repository's own worktrees, a CI cache mount, a developer's mapped
 * drive) must not be refused: the redirect defence below only has to protect the paths
 * BELOW the root, because those are the ones the commit under review can move.
 */
function canonicalRoot(repoRoot) {
  const resolved = path.resolve(repoRoot);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// Inside the repository, every component from the canonical root down must be an ordinary
// directory. Checking only the leaf would let a link on `openspec` or `docs/plans`
// redirect the whole comparison at state that does not belong to the commit under review.
function assertOrdinary(root, target, expected, field) {
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(root, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('invalid_argument', field, `Lifecycle input escapes the repository root: ${field}`);
  }
  let cursor = root;
  const components = relative === '' ? [] : relative.split(path.sep);
  for (const [index, component] of components.entries()) {
    cursor = path.join(cursor, component);
    const stats = lstatOrNull(cursor);
    if (stats === null) {
      fail('unreadable_path', field, `Lifecycle input is unreadable: ${field}`);
    }
    if (stats.isSymbolicLink()) {
      fail('reparse_path', field, `Lifecycle input must not be reached through a link: ${field}`);
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      fail('unreadable_path', field, `Lifecycle input parent is not a directory: ${field}`);
    }
  }
  const leaf = lstatOrNull(resolvedTarget);
  if (leaf === null) {
    fail('unreadable_path', field, `Lifecycle input is unreadable: ${field}`);
  }
  if (expected === 'file' && !leaf.isFile()) {
    fail('unreadable_path', field, `Lifecycle input must be a regular file: ${field}`);
  }
  if (expected === 'directory' && !leaf.isDirectory()) {
    fail('unreadable_path', field, `Lifecycle input must be a directory: ${field}`);
  }
  return leaf;
}

function readBoundedText(root, target, field) {
  const stats = assertOrdinary(root, target, 'file', field);
  if (stats.size > MAX_FILE_BYTES) {
    fail('input_too_large', field, `Lifecycle input exceeds the bounded read budget: ${field}`);
  }
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch {
    fail('unreadable_path', field, `Lifecycle input is unreadable: ${field}`);
  }
  // The size budget above is advisory (the file can change between lstat and read), so the
  // decoded length is what actually bounds the parsers below.
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    fail('input_too_large', field, `Lifecycle input exceeds the bounded read budget: ${field}`);
  }
  // A UTF-8 BOM would silently break the fenced-block and marker parsing below.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Lists the child entries of a controlled lifecycle namespace. Non-directory entries are
 * NOT filtered out: `Dirent.isDirectory()` is false both for a plain file and for a
 * symlink to a directory, and on Windows git checks a symlink out as a plain file, so
 * filtering would let an undeclared change hide from the comparison entirely. Links are
 * refused outright; anything else that is not a directory is returned so the comparator
 * can report it.
 */
function listChildEntries(root, target, field, limit) {
  assertOrdinary(root, target, 'directory', field);
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    fail('unreadable_path', field, `Lifecycle directory is unreadable: ${field}`);
  }
  if (entries.length > limit) {
    fail('input_too_large', field, `Lifecycle directory exceeds the bounded entry budget: ${field}`);
  }
  return entries
    .map((entry) => {
      if (entry.isSymbolicLink()) {
        fail('reparse_path', `${field}/${entry.name}`,
          `Lifecycle directory entry must not be a link: ${field}/${entry.name}`);
      }
      return { name: entry.name, isDirectory: entry.isDirectory() };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

/**
 * Parses openspec/lifecycle-ledger.json down to the two fields this gate compares.
 * Anything the declared schema does not allow is refused rather than skipped.
 */
export function parseLifecycleLedger(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    fail('ledger_invalid', 'ledger', 'Lifecycle ledger is not valid JSON.');
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail('ledger_invalid', 'ledger', 'Lifecycle ledger must be a JSON object.');
  }
  if (document.schema_version !== LEDGER_SCHEMA_VERSION) {
    fail('ledger_invalid', 'ledger.schema_version',
      `Lifecycle ledger must declare ${LEDGER_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(document.changes)) {
    fail('ledger_invalid', 'ledger.changes', 'Lifecycle ledger changes must be an array.');
  }
  if (document.changes.length > MAX_LEDGER_ROWS) {
    fail('input_too_large', 'ledger.changes', 'Lifecycle ledger exceeds the bounded row budget.');
  }
  const rows = new Map();
  for (const [index, row] of document.changes.entries()) {
    const field = `ledger.changes[${index}]`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      fail('ledger_invalid', field, 'Lifecycle ledger row must be an object.');
    }
    if (typeof row.id !== 'string' || !CHANGE_ID.test(row.id)) {
      fail('ledger_invalid', `${field}.id`, 'Lifecycle ledger row id is not a canonical change id.');
    }
    if (typeof row.status !== 'string' || !STATUS.has(row.status)) {
      fail('ledger_invalid', `${field}.status`, `Lifecycle ledger row ${row.id} has an unknown status.`);
    }
    if (rows.has(row.id)) {
      fail('ledger_invalid', `${field}.id`, `Lifecycle ledger declares ${row.id} more than once.`);
    }
    rows.set(row.id, row.status);
  }
  return rows;
}

// Deliberately linear: a `/^```json\s*([\s\S]*?)\s*```$/` form backtracks super-linearly on
// an unterminated fence, which would let any pull request burn the required check's whole
// job budget instead of failing fast.
function extractFencedJson(body) {
  if (!body.startsWith(FENCE_OPEN) || !body.endsWith(FENCE_CLOSE) ||
      body.length < FENCE_OPEN.length + FENCE_CLOSE.length) {
    fail('now_invalid', 'now', 'NOW lifecycle projection must be a fenced json block.');
  }
  const inner = body.slice(FENCE_OPEN.length, body.length - FENCE_CLOSE.length);
  // A CommonMark info string ends at whitespace, so ```jsonc must not read as ```json.
  if (inner.length > 0 && !/^\s/u.test(inner)) {
    fail('now_invalid', 'now', 'NOW lifecycle projection must be a fenced json block.');
  }
  return inner;
}

/**
 * Extracts the fenced projection embedded in docs/plans/NOW.md. The marker pair must
 * appear exactly once: a second pair would let a change hide real state in the block the
 * comparator does not read.
 */
export function parseNowProjection(text) {
  if (text.split(NOW_START).length !== 2 || text.split(NOW_END).length !== 2) {
    fail('now_invalid', 'now', 'NOW must contain exactly one lifecycle projection block.');
  }
  const startIndex = text.indexOf(NOW_START);
  const endIndex = text.indexOf(NOW_END);
  if (endIndex < startIndex) {
    fail('now_invalid', 'now', 'NOW lifecycle projection markers are inverted.');
  }
  const body = text.slice(startIndex + NOW_START.length, endIndex).trim();
  let document;
  try {
    document = JSON.parse(extractFencedJson(body));
  } catch (error) {
    if (error instanceof RepositoryLifecycleInputError) throw error;
    fail('now_invalid', 'now', 'NOW lifecycle projection is not valid JSON.');
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail('now_invalid', 'now', 'NOW lifecycle projection must be a JSON object.');
  }
  if (document.schema_version !== NOW_SCHEMA_VERSION || document.scope !== 'current' ||
      !Array.isArray(document.changes)) {
    fail('now_invalid', 'now', `NOW lifecycle projection must declare ${NOW_SCHEMA_VERSION} at current scope.`);
  }
  if (document.changes.length > MAX_CURRENT_CHANGES) {
    fail('input_too_large', 'now.changes', 'NOW lifecycle projection exceeds the bounded row budget.');
  }
  const rows = new Map();
  for (const [index, row] of document.changes.entries()) {
    const field = `now.changes[${index}]`;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      fail('now_invalid', field, 'NOW lifecycle projection row must be an object.');
    }
    if (typeof row.id !== 'string' || !CHANGE_ID.test(row.id)) {
      fail('now_invalid', `${field}.id`, 'NOW lifecycle projection row id is not a canonical change id.');
    }
    // `archived` is a legal spelling here even though the projection scope is `current`:
    // an archived row projected into NOW is drift to report, not an input the gate is
    // unable to read.
    if (typeof row.status !== 'string' || !STATUS.has(row.status)) {
      fail('now_invalid', `${field}.status`, `NOW lifecycle projection row ${row.id} has an unknown status.`);
    }
    if (rows.has(row.id)) {
      fail('now_invalid', `${field}.id`, `NOW lifecycle projection declares ${row.id} more than once.`);
    }
    rows.set(row.id, row.status);
  }
  return rows;
}

/**
 * Mirrors the proposal marker semantics owned by openspec-machine-truth.mjs: the marker
 * lives in the prologue, `adopted` means completed, and a second marker is invalid rather
 * than last-wins.
 *
 * One deliberate addition: an absent marker means active there, which is safe for a
 * reporting comparator but would be a silent default here, because a bolded near-miss
 * spelling (`> **Status:** deferred`, `> **Status : deferred**`) would read as active and
 * agree with an `active` ledger row for entirely the wrong reason. Such a prologue returns
 * `near-miss`, which the comparator reports. The detector requires the bold run to open
 * immediately before `Status` so that ordinary blockquote prose ("> Status quo",
 * "> **Implementation status**") is not caught.
 */
export function proposalLifecycleStatus(text) {
  const prologue = text.split(/\r?\n/u).slice(0, PROLOGUE_LINES).join('\n');
  const markers = [...prologue.matchAll(/^>\s*\*\*Status:\s*([a-z-]+)/gimu)].map((match) => match[1].toLowerCase());
  if (markers.length > 1) return MARKER_INVALID;
  if (markers.length === 0) {
    return /^[^\S\n]{0,3}>[^\n]*\*\*\s*Status\b/imu.test(prologue) ? MARKER_NEAR_MISS : 'active';
  }
  if (markers[0] === 'adopted') return 'completed';
  return STATUS.has(markers[0]) ? markers[0] : MARKER_INVALID;
}

/**
 * Reads the three repository-local lifecycle sources into a plain observation object.
 * Kept separate from the comparison so tests can drive the comparator directly.
 */
export function collectRepositoryObservation(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    fail('invalid_argument', 'repo_root', 'Repository root must be a non-empty path.');
  }
  const root = canonicalRoot(repoRoot);
  assertOrdinary(root, root, 'directory', 'repo_root');

  const changesRoot = path.join(root, 'openspec', 'changes');
  const archiveRoot = path.join(changesRoot, 'archive');

  const ledger = parseLifecycleLedger(
    readBoundedText(root, path.join(root, 'openspec', 'lifecycle-ledger.json'), 'openspec/lifecycle-ledger.json'));
  const now = parseNowProjection(
    readBoundedText(root, path.join(root, 'docs', 'plans', 'NOW.md'), 'docs/plans/NOW.md'));

  const changeEntries = listChildEntries(root, changesRoot, 'openspec/changes', MAX_CURRENT_CHANGES)
    .filter((entry) => entry.name !== 'archive');
  const archiveEntries = listChildEntries(root, archiveRoot, 'openspec/changes/archive', MAX_ARCHIVE_DIRECTORIES);

  const proposalStatuses = new Map();
  for (const entry of changeEntries) {
    if (!entry.isDirectory || !CHANGE_ID.test(entry.name)) continue;
    const proposal = path.join(changesRoot, entry.name, 'proposal.md');
    const stats = lstatOrNull(proposal);
    if (stats === null) {
      proposalStatuses.set(entry.name, PROPOSAL_ABSENT);
      continue;
    }
    // A linked or non-regular proposal.md is something an author wrote, so it is reported
    // rather than allowed to abort the comparison of every other row.
    if (stats.isSymbolicLink() || !stats.isFile()) {
      proposalStatuses.set(entry.name, PROPOSAL_UNREADABLE_FILE);
      continue;
    }
    proposalStatuses.set(entry.name, proposalLifecycleStatus(
      readBoundedText(root, proposal, `openspec/changes/${entry.name}/proposal.md`)));
  }

  return { ledger, now, changeEntries, archiveEntries, proposalStatuses };
}

function mismatch(code, changeId, expectedSource, expected, actualSource, actual, message) {
  return {
    code,
    change_id: changeId,
    expected_source: expectedSource,
    expected: expected === null ? null : String(expected),
    actual_source: actualSource,
    actual: actual === null ? null : String(actual),
    message,
  };
}

function isCalendarDate(year, month, day) {
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() === Number(month) - 1 &&
    parsed.getUTCDate() === Number(day);
}

/**
 * Compares the three sources and returns a deterministic, fully sorted report.
 * Disagreement is reported, never resolved: this gate has no authority to decide which
 * source is right, only to refuse a tree in which they disagree.
 */
export function compareRepositoryLifecycle(observation) {
  if (observation === null || typeof observation !== 'object') {
    fail('invalid_argument', 'observation', 'Lifecycle observation must be an object.');
  }
  const { ledger, now, changeEntries, archiveEntries, proposalStatuses } = observation;
  if (!(ledger instanceof Map) || !(now instanceof Map) || !(proposalStatuses instanceof Map) ||
      !Array.isArray(changeEntries) || !Array.isArray(archiveEntries)) {
    fail('invalid_argument', 'observation', 'Lifecycle observation is missing a required source.');
  }

  const currentLedger = new Map([...ledger].filter(([, status]) => status !== 'archived'));
  const archivedLedger = new Set([...ledger].filter(([, status]) => status === 'archived').map(([id]) => id));
  const mismatches = [];

  // 1. NOW projection versus the current machine-ledger rows.
  for (const [id, status] of now) {
    if (!currentLedger.has(id)) {
      mismatches.push(mismatch('now_unexpected_change', id, 'lifecycle_ledger.current', 'absent',
        'now_projection', status,
        'NOW projects a change that the machine ledger does not carry as current.'));
    } else if (currentLedger.get(id) !== status) {
      mismatches.push(mismatch('now_lifecycle_disagreement', id, 'lifecycle_ledger', currentLedger.get(id),
        'now_projection', status, 'NOW lifecycle status disagrees with the machine ledger.'));
    }
  }
  for (const [id, status] of currentLedger) {
    if (!now.has(id)) {
      mismatches.push(mismatch('now_change_missing', id, 'lifecycle_ledger.current', status,
        'now_projection', 'absent', 'NOW omits a current machine-ledger change.'));
    }
  }

  // 2. Current machine-ledger rows versus the change directories on disk.
  const directorySet = new Set(changeEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name));
  for (const [id, status] of currentLedger) {
    if (!directorySet.has(id)) {
      mismatches.push(mismatch('ledger_current_without_directory', id, 'lifecycle_ledger.current', status,
        'openspec_changes', 'absent',
        'A current machine-ledger change has no openspec/changes directory.'));
    }
  }
  for (const entry of changeEntries) {
    if (!entry.isDirectory) {
      mismatches.push(mismatch('change_entry_not_a_directory', null, 'openspec_changes_contract', 'directory',
        'openspec_changes', entry.name,
        'openspec/changes contains an entry that is not a directory; it cannot be a change and must not hide there.'));
      continue;
    }
    if (!CHANGE_ID.test(entry.name)) {
      mismatches.push(mismatch('change_directory_malformed', null, 'change_id_contract', 'kebab-case id',
        'openspec_changes', entry.name, 'An openspec/changes directory is not a canonical change id.'));
      continue;
    }
    if (archivedLedger.has(entry.name)) {
      mismatches.push(mismatch('duplicate_active_archive', entry.name, 'lifecycle_ledger', 'archived',
        'openspec_changes', entry.name,
        'An archived change still has a live openspec/changes directory.'));
      continue;
    }
    if (!currentLedger.has(entry.name)) {
      mismatches.push(mismatch('directory_without_ledger_row', entry.name, 'lifecycle_ledger.current', 'present',
        'openspec_changes', 'absent',
        'An openspec/changes directory has no current machine-ledger row.'));
    }
  }

  // 3. Archived machine-ledger rows versus the dated archive directories on disk.
  const archiveById = new Map();
  for (const entry of archiveEntries) {
    if (!entry.isDirectory) {
      mismatches.push(mismatch('archive_entry_not_a_directory', null, 'archive_naming_contract', 'directory',
        'openspec_changes_archive', entry.name,
        'openspec/changes/archive contains an entry that is not a directory.'));
      continue;
    }
    const parsed = entry.name.match(ARCHIVE_DIRECTORY);
    if (!parsed || !isCalendarDate(parsed[1], parsed[2], parsed[3])) {
      mismatches.push(mismatch('archive_directory_malformed', null, 'archive_naming_contract',
        'YYYY-MM-DD-<change-id>', 'openspec_changes_archive', entry.name,
        'An archive directory does not use the dated canonical archive name.'));
      continue;
    }
    const id = parsed[4];
    if (archiveById.has(id)) {
      mismatches.push(mismatch('archive_directory_duplicate', id, 'archive_naming_contract', 'one archive directory',
        'openspec_changes_archive', entry.name,
        'A change id owns more than one dated archive directory.'));
      continue;
    }
    archiveById.set(id, entry.name);
  }
  for (const id of archivedLedger) {
    if (!archiveById.has(id)) {
      mismatches.push(mismatch('ledger_archived_without_archive_directory', id, 'lifecycle_ledger', 'archived',
        'openspec_changes_archive', 'absent',
        'An archived machine-ledger row has no dated archive directory.'));
    }
  }
  for (const id of archiveById.keys()) {
    if (!archivedLedger.has(id)) {
      mismatches.push(mismatch('archive_directory_without_ledger_row', id, 'lifecycle_ledger', 'archived',
        'openspec_changes_archive', archiveById.get(id),
        'An archive directory has no archived machine-ledger row.'));
    }
  }

  // 4. Current machine-ledger status versus the proposal marker that owns it on disk.
  for (const [id, status] of currentLedger) {
    if (!proposalStatuses.has(id)) continue;
    const observed = proposalStatuses.get(id);
    if (observed === PROPOSAL_ABSENT) {
      mismatches.push(mismatch('proposal_missing', id, 'openspec_changes', 'proposal.md',
        'openspec_changes', 'absent', 'A current change directory has no proposal.md.'));
      continue;
    }
    if (observed === PROPOSAL_UNREADABLE_FILE) {
      mismatches.push(mismatch('proposal_unreadable', id, 'openspec_changes', 'regular file',
        'openspec_changes', 'link or non-regular file',
        'A current change proposal.md is not a regular file, so its lifecycle marker cannot be trusted.'));
      continue;
    }
    if (observed === MARKER_NEAR_MISS) {
      mismatches.push(mismatch('proposal_marker_unreadable', id, 'proposal_marker_contract',
        '> **Status: <status>', 'proposal_marker', 'near-miss marker',
        'The proposal prologue carries a bolded status line the canonical marker parse cannot read.'));
      continue;
    }
    if (observed === MARKER_INVALID) {
      mismatches.push(mismatch('proposal_marker_invalid', id, 'proposal_marker_contract',
        '> **Status: <status>', 'proposal_marker', 'invalid',
        'The proposal lifecycle marker is duplicated or spells an unknown status.'));
      continue;
    }
    if (observed !== status) {
      mismatches.push(mismatch('proposal_status_disagreement', id, 'lifecycle_ledger', status,
        'proposal_marker', observed, 'The proposal lifecycle marker disagrees with the machine ledger.'));
    }
  }

  mismatches.sort((left, right) => (
    left.code.localeCompare(right.code, 'en') ||
    String(left.change_id ?? '').localeCompare(String(right.change_id ?? ''), 'en') ||
    String(left.actual ?? '').localeCompare(String(right.actual ?? ''), 'en')
  ));

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    current_ledger_rows: currentLedger.size,
    archived_ledger_rows: archivedLedger.size,
    now_rows: now.size,
    change_directories: directorySet.size,
    archive_directories: archiveById.size,
    mismatch_count: mismatches.length,
    mismatches,
  };
}

/**
 * Convenience entry point: observe the repository and compare in one call.
 */
export function evaluateRepositoryLifecycle(repoRoot) {
  return compareRepositoryLifecycle(collectRepositoryObservation(repoRoot));
}
