#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import {
  MachineTruthInputError,
  evaluateOpenSpecMachineTruth,
  loadOpenSpecMachineTruthInputs,
  taskLedgerFromText,
} from '../lib/openspec-machine-truth.mjs';

const MAX_UNIQUE_SUBJECTS = 64;
const MAX_OBSERVED_PATHS = 10_000;
const MAX_OBSERVED_PATH_BYTES = 2 * 1024 * 1024;
const MAX_RAW_OBSERVED_PATHS = 10_000;
const MAX_RAW_OBSERVED_PATH_BYTES = 2 * 1024 * 1024;

function usage() {
  return [
    'Usage: node scripts/tests/verify-openspec-machine-truth.mjs',
    '  --repo-root <path> --ledger <path> --now <path>',
    '  --github-state <path> --openspec-list <path> --subject <40-hex> --base <40-hex>',
  ].join('\n');
}

function parseArguments(argv) {
  const allowed = new Set([
    '--repo-root', '--ledger', '--now', '--github-state', '--openspec-list', '--subject', '--base',
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.startsWith('--')) {
      throw new MachineTruthInputError('invalid_argument', 'arguments', usage());
    }
    if (result[flag] !== undefined) {
      throw new MachineTruthInputError('invalid_argument', 'arguments', `Duplicate argument: ${flag}`);
    }
    result[flag] = value;
  }
  for (const required of ['--repo-root', '--ledger', '--now', '--github-state', '--openspec-list', '--subject', '--base']) {
    if (!result[required]) throw new MachineTruthInputError('invalid_argument', 'arguments', usage());
  }
  return result;
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isWithin(root, candidate, allowEqual = false) {
  const rootKey = pathKey(path.resolve(root));
  const candidateKey = pathKey(path.resolve(candidate));
  return (allowEqual && candidateKey === rootKey) || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function assertNoLinks(anchor, target, field) {
  let cursor = anchor;
  for (const segment of path.relative(anchor, target).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new MachineTruthInputError('artifact_untrusted', field, `${field} contains a link or reparse component.`);
    }
  }
}

function assertTrustedRepository(value) {
  const requested = path.resolve(value);
  if (process.platform === 'win32' && /^(?:\\\\|\\\\\?\\|\\\\\.\\)/u.test(requested)) {
    throw new MachineTruthInputError('repository_invalid', 'repo_root', 'UNC and device repository roots are not trusted.');
  }
  const repoRoot = realpathSync(requested);
  const filesystemRoot = path.parse(repoRoot).root;
  assertNoLinks(filesystemRoot, repoRoot, 'repo_root');
  const tempCandidates = [tmpdir(), process.env.TEMP, process.env.TMP, process.env.RUNNER_TEMP]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  if (tempCandidates.some((entry) => isWithin(entry, repoRoot, true))) {
    throw new MachineTruthInputError('repository_invalid', 'repo_root', 'Repository root must not be inside a temporary directory.');
  }
  return repoRoot;
}

function resolveInput(repoRoot, value, field) {
  const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repoRoot, value);
  if (!isWithin(repoRoot, candidate)) {
    throw new MachineTruthInputError('artifact_untrusted', field, `${field} must be repository-contained.`);
  }
  assertNoLinks(repoRoot, candidate, field);
  const real = realpathSync(candidate);
  if (!isWithin(repoRoot, real)) {
    throw new MachineTruthInputError('artifact_untrusted', field, `${field} resolves outside the repository.`);
  }
  return real;
}

function readBoundedText(filePath, label) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 2 * 1024 * 1024) {
    throw new MachineTruthInputError('artifact_untrusted', label, `${label} must be a bounded regular file.`);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath));
}

function assertGitSubject(repoRoot, subjectCommit) {
  const safeRoot = repoRoot.replaceAll('\\', '/');
  const topLevel = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, '-C', repoRoot, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (topLevel.status !== 0 || pathKey(realpathSync(topLevel.stdout.trim())) !== pathKey(realpathSync(repoRoot))) {
    throw new MachineTruthInputError('repository_invalid', 'repo_root', 'RepoRoot is not the exact Git worktree root.');
  }
  const verified = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, '-C', repoRoot, 'rev-parse', '--verify', `${subjectCommit}^{commit}`], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (verified.status !== 0 || verified.stdout.trim().toLowerCase() !== subjectCommit) {
    throw new MachineTruthInputError('subject_unavailable', 'subject_commit', 'Trusted subject is not a local commit.');
  }
  const head = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, '-C', repoRoot, 'rev-parse', '--verify', 'HEAD^{commit}'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (head.status !== 0 || head.stdout.trim().toLowerCase() !== subjectCommit) {
    throw new MachineTruthInputError('subject_not_head', 'subject_commit', 'Trusted subject must equal the exact checked-out HEAD.');
  }
}

function gitOutput(repoRoot, args, field, allowFailure = false) {
  const safeRoot = repoRoot.replaceAll('\\', '/');
  const result = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, '-C', repoRoot, ...args], {
    encoding: 'buffer',
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new MachineTruthInputError('repository_invalid', field, `Git observation failed for ${field}.`);
  }
  return result;
}

function decodeNulList(buffer, field) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return text.split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/'));
  } catch {
    throw new MachineTruthInputError('source_observation_invalid', field, 'Git path output is not valid UTF-8.');
  }
}

function isOwnedOpenSpecSource(changeId, candidate) {
  if (candidate.startsWith(`openspec/changes/${changeId}/`)) return true;
  const escapedId = changeId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${escapedId}/`, 'u').test(candidate);
}

export function createRawObservationBudget() {
  return { path_count: 0, utf8_bytes: 0 };
}

export function consumeRawObservationPaths(budget, paths, field) {
  if (!budget || !Number.isInteger(budget.path_count) || !Number.isInteger(budget.utf8_bytes) || !Array.isArray(paths)) {
    throw new MachineTruthInputError('source_observation_invalid', field, 'Raw source observation budget is invalid.');
  }
  const pathCount = paths.length;
  const utf8Bytes = paths.reduce((total, value) => {
    if (typeof value !== 'string' || !value || value.includes('\0')) {
      throw new MachineTruthInputError('source_observation_invalid', field, 'Raw source observation path is invalid.');
    }
    return total + Buffer.byteLength(value, 'utf8');
  }, 0);
  if (budget.path_count + pathCount > MAX_RAW_OBSERVED_PATHS || budget.utf8_bytes + utf8Bytes > MAX_RAW_OBSERVED_PATH_BYTES) {
    throw new MachineTruthInputError('source_observation_invalid', field, 'Raw source observations exceed the global bounded budget.');
  }
  budget.path_count += pathCount;
  budget.utf8_bytes += utf8Bytes;
}

function assertGitBase(repoRoot, baseCommit) {
  if (!/^[0-9a-f]{40}$/u.test(baseCommit)) {
    throw new MachineTruthInputError('base_unavailable', 'base_commit', 'Trusted base must be a lowercase full commit SHA.');
  }
  const available = gitOutput(repoRoot, ['cat-file', '-e', `${baseCommit}^{commit}`], 'base_commit', true);
  if (available.status !== 0) {
    throw new MachineTruthInputError('base_unavailable', 'base_commit', 'Trusted base is not a local commit.');
  }
  const ancestor = gitOutput(repoRoot, ['merge-base', '--is-ancestor', baseCommit, 'HEAD'], 'base_commit', true);
  if (ancestor.status !== 0) {
    throw new MachineTruthInputError('base_not_ancestor', 'base_commit', 'Trusted base must be an ancestor of the checked-out HEAD.');
  }
}

export function assertRowSubjectAncestor(repoRoot, change, cache) {
  if (cache.has(change.subject_commit)) return false;
  const available = gitOutput(repoRoot, ['cat-file', '-e', `${change.subject_commit}^{commit}`],
    `source_observations.${change.id}.subject_commit`, true);
  if (available.status !== 0) {
    throw new MachineTruthInputError('subject_unavailable', `source_observations.${change.id}.subject_commit`,
      'Lifecycle row subject is not a local commit.');
  }
  const ancestor = gitOutput(repoRoot, ['merge-base', '--is-ancestor', change.subject_commit, 'HEAD'],
    `source_observations.${change.id}.subject_commit`, true);
  if (ancestor.status !== 0) {
    throw new MachineTruthInputError('subject_not_ancestor', `source_observations.${change.id}.subject_commit`,
      'Lifecycle row subject must be an ancestor of the checked-out HEAD.');
  }
  cache.add(change.subject_commit);
  return true;
}

export function changedPathsSince(repoRoot, subjectCommit, cache, rawBudget) {
  if (cache.has(subjectCommit)) return cache.get(subjectCommit);
  const tracked = gitOutput(repoRoot, ['-c', 'core.quotepath=false', 'diff', '--name-only', '-z', '--no-renames',
    `${subjectCommit}..HEAD`, '--'], `source_observations.${subjectCommit}.diff`);
  const paths = decodeNulList(tracked.stdout, `source_observations.${subjectCommit}.diff`);
  consumeRawObservationPaths(rawBudget, paths, `source_observations.${subjectCommit}.diff`);
  cache.set(subjectCommit, paths);
  return paths;
}

export function collectSourceObservations(repoRoot, ledger) {
  if (!ledger || !Array.isArray(ledger.changes) || ledger.changes.length > 500) {
    throw new MachineTruthInputError('source_observation_invalid', 'ledger.changes', 'Lifecycle rows are invalid for source observation.');
  }
  const worktree = gitOutput(repoRoot, ['-c', 'core.quotepath=false', 'diff', '--name-only', '-z', '--no-renames', 'HEAD', '--'],
    'source_worktree');
  const untracked = gitOutput(repoRoot, ['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z'],
    'source_untracked');
  const rawBudget = createRawObservationBudget();
  const worktreePaths = decodeNulList(worktree.stdout, 'source_worktree');
  const untrackedPaths = decodeNulList(untracked.stdout, 'source_untracked');
  consumeRawObservationPaths(rawBudget, worktreePaths, 'source_worktree');
  consumeRawObservationPaths(rawBudget, untrackedPaths, 'source_untracked');
  const localPaths = [...worktreePaths, ...untrackedPaths];
  const tracked = gitOutput(repoRoot, ['-c', 'core.quotepath=false', 'ls-files', '-z'], 'tracked_evidence_paths');
  const trackedEvidencePaths = decodeNulList(tracked.stdout, 'tracked_evidence_paths');
  consumeRawObservationPaths(rawBudget, trackedEvidencePaths, 'tracked_evidence_paths');
  const bySubject = new Map();
  const checkedSubjects = new Set();
  const seen = new Set();
  const subjects = new Set(ledger.changes.map((change) => change?.subject_commit));
  if (subjects.size > MAX_UNIQUE_SUBJECTS) {
    throw new MachineTruthInputError('source_observation_invalid', 'ledger.changes', 'Lifecycle rows exceed the unique subject budget.');
  }
  let aggregatePaths = 0;
  let aggregateBytes = 0;
  const sourceObservations = ledger.changes.map((change) => {
    if (!change || typeof change.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(change.id) || seen.has(change.id) ||
        typeof change.subject_commit !== 'string' || !/^[0-9a-f]{40}$/u.test(change.subject_commit) ||
        !Array.isArray(change.evidence_refs)) {
      throw new MachineTruthInputError('source_observation_invalid', 'ledger.changes', 'Lifecycle row identity is invalid for source observation.');
    }
    seen.add(change.id);
    assertRowSubjectAncestor(repoRoot, change, checkedSubjects);
    const evidence = new Set(change.evidence_refs.filter((reference) => typeof reference === 'string')
      .map((reference) => reference.replaceAll('\\', '/')));
    const changedPaths = [...new Set([
      ...changedPathsSince(repoRoot, change.subject_commit, bySubject, rawBudget),
      ...localPaths,
    ])].filter((candidate) => isOwnedOpenSpecSource(change.id, candidate) || evidence.has(candidate));
    aggregatePaths += changedPaths.length;
    aggregateBytes += changedPaths.reduce((total, value) => total + Buffer.byteLength(value, 'utf8'), 0);
    if (changedPaths.length > MAX_OBSERVED_PATHS || aggregatePaths > MAX_OBSERVED_PATHS || aggregateBytes > MAX_OBSERVED_PATH_BYTES) {
      throw new MachineTruthInputError('source_observation_invalid', `source_observations.${change.id}`,
        'Lifecycle row source observation exceeds the path budget.');
    }
    return { change_id: change.id, subject_commit: change.subject_commit, changed_paths: changedPaths };
  });
  return { sourceObservations, trackedEvidencePaths };
}

function previousLedgerAtBase(repoRoot, baseCommit) {
  const object = `${baseCommit}:openspec/lifecycle-ledger.json`;
  const exists = gitOutput(repoRoot, ['cat-file', '-e', object], 'previous_ledger', true);
  if (exists.status !== 0) return null;
  const shown = gitOutput(repoRoot, ['show', object], 'previous_ledger');
  if (shown.stdout.length > 2 * 1024 * 1024) {
    throw new MachineTruthInputError('artifact_too_large', 'previous_ledger', 'Previous ledger exceeds the size limit.');
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(shown.stdout));
  } catch {
    throw new MachineTruthInputError('artifact_invalid_json', 'previous_ledger', 'Previous ledger is invalid JSON.');
  }
}

function baselineArchiveTasksAtSubject(repoRoot, subjectCommit, ledger) {
  const debtIds = new Set(ledger.changes.filter(({ archive_debt: debt }) => debt !== null).map(({ id }) => id));
  if (debtIds.size === 0) return {};
  const listed = gitOutput(repoRoot, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', '-z',
    subjectCommit, '--', 'openspec/changes/archive'], 'baseline_archive_tasks');
  const paths = decodeNulList(listed.stdout, 'baseline_archive_tasks');
  const result = {};
  for (const id of debtIds) {
    const suffix = `/tasks.md`;
    const candidates = paths.filter((filePath) => {
      const match = filePath.match(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-(.+)\/tasks\.md$/u);
      return filePath.endsWith(suffix) && match?.[1] === id;
    });
    if (candidates.length !== 1) {
      throw new MachineTruthInputError('source_observation_invalid', 'baseline_archive_tasks',
        `Trusted subject must contain exactly one archived tasks.md for debt change ${id}.`);
    }
    const shown = gitOutput(repoRoot, ['show', `${subjectCommit}:${candidates[0]}`], 'baseline_archive_tasks');
    if (shown.stdout.length > 2 * 1024 * 1024) {
      throw new MachineTruthInputError('artifact_too_large', 'baseline_archive_tasks', 'Archived tasks baseline exceeds the size limit.');
    }
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(shown.stdout);
    } catch {
      throw new MachineTruthInputError('source_observation_invalid', 'baseline_archive_tasks',
        'Archived tasks baseline is not valid UTF-8.');
    }
    result[id] = taskLedgerFromText(text);
  }
  return result;
}

function errorReport(error) {
  const known = error instanceof MachineTruthInputError;
  return {
    schema_version: 'openspec-machine-truth-report/v1',
    result: 'input_error',
    subject_commit: null,
    sources: {
      ledger: 'unavailable',
      now: 'unavailable',
      github: 'unavailable',
      openspec: 'unavailable',
      previous_ledger: 'unavailable',
    },
    summary: { change_count: 0, active_count: 0, archive_count: 0, archive_debt_count: 0, mismatch_count: 0 },
    mismatches: [],
    errors: [{
      code: known ? error.code : 'input_unreadable',
      field: known ? error.field : 'input',
      message: known ? error.message : 'Machine-truth input could not be read safely.',
    }],
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const repoRoot = assertTrustedRepository(args['--repo-root']);
    const subjectCommit = args['--subject'].toLowerCase();
    const baseCommit = args['--base'].toLowerCase();
    assertGitSubject(repoRoot, subjectCommit);
    assertGitBase(repoRoot, baseCommit);
    const input = loadOpenSpecMachineTruthInputs({
      ledgerPath: resolveInput(repoRoot, args['--ledger'], 'ledger'),
      githubPath: resolveInput(repoRoot, args['--github-state'], 'github_state'),
      openSpecPath: resolveInput(repoRoot, args['--openspec-list'], 'openspec_list'),
      previousLedgerPath: null,
    });
    input.previousLedger = previousLedgerAtBase(repoRoot, baseCommit);
    input.baselineArchiveTasks = input.previousLedger === null
      ? baselineArchiveTasksAtSubject(repoRoot, subjectCommit, input.ledger)
      : null;
    const source = collectSourceObservations(repoRoot, input.ledger);
    const report = evaluateOpenSpecMachineTruth({
      repoRoot,
      ...input,
      nowText: readBoundedText(resolveInput(repoRoot, args['--now'], 'now'), 'now'),
      subjectCommit,
      ...source,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.result === 'consistent' || report.result === 'consistent_with_accepted_debt' ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(errorReport(error))}\n`);
    process.exitCode = 3;
  }
}
