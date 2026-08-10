// scripts/tests/verify-openspec-repository-lifecycle.mjs
// Network-free gate: refuses a tree whose three repository-local OpenSpec lifecycle
// sources disagree (change directories + proposal markers, openspec/lifecycle-ledger.json,
// and the docs/plans/NOW.md projection).
//
// Unlike verify-openspec-machine-truth.mjs this command needs no GitHub observation and no
// pinned `openspec` binary, so it can run against the real repository on every pull request.
//
// Exit codes: 0 parity, 2 mismatch, 3 input error. An unexpected internal fault propagates
// as an uncaught exception (exit 1); every documented outcome is non-zero except parity, so
// every failure mode is fail-closed for a caller that checks for exactly 0.
// The command never writes to the tree.

import { realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  RepositoryLifecycleInputError,
  evaluateRepositoryLifecycle,
} from '../lib/openspec-repository-lifecycle.mjs';

export const EXIT_PARITY = 0;
export const EXIT_MISMATCH = 2;
export const EXIT_INPUT_ERROR = 3;

function usage() {
  return [
    'Usage: node scripts/tests/verify-openspec-repository-lifecycle.mjs',
    '  [--repo-root <path>] [--format text|json]',
  ].join('\n');
}

export function parseArguments(argv) {
  const allowed = new Set(['--repo-root', '--format']);
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value === undefined || value.startsWith('--')) {
      throw new RepositoryLifecycleInputError('invalid_argument', 'arguments', usage());
    }
    if (parsed[flag] !== undefined) {
      throw new RepositoryLifecycleInputError('invalid_argument', 'arguments', `Duplicate argument: ${flag}`);
    }
    parsed[flag] = value;
  }
  const format = parsed['--format'] ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new RepositoryLifecycleInputError('invalid_argument', '--format', usage());
  }
  return { repoRoot: parsed['--repo-root'] ?? process.cwd(), format };
}

// The requested format has to be honoured even when the arguments themselves are what
// failed, otherwise a caller parsing stderr as JSON gets prose on exactly the paths it is
// most likely to hit.
function requestedFormat(argv) {
  const index = argv.lastIndexOf('--format');
  return index >= 0 && argv[index + 1] === 'json' ? 'json' : 'text';
}

function renderError(error, format) {
  if (format === 'json') {
    return JSON.stringify({
      schema_version: 'openspec-repository-lifecycle-error/v1',
      code: error.code,
      field: error.field,
      message: error.message,
    });
  }
  return `${error.code} (${error.field}): ${error.message}`;
}

function renderText(report) {
  const lines = [
    `openspec repository lifecycle: current=${report.current_ledger_rows} archived=${report.archived_ledger_rows} ` +
    `now=${report.now_rows} change_dirs=${report.change_directories} archive_dirs=${report.archive_directories}`,
  ];
  for (const item of report.mismatches) {
    lines.push(
      `MISMATCH ${item.code} change=${item.change_id ?? '<none>'} ` +
      `expected(${item.expected_source})=${item.expected ?? '<null>'} ` +
      `actual(${item.actual_source})=${item.actual ?? '<null>'} :: ${item.message}`);
  }
  lines.push(report.mismatch_count === 0
    ? 'openspec repository lifecycle OK: all three sources agree.'
    : `openspec repository lifecycle FAILED with ${report.mismatch_count} mismatch(es).`);
  return lines.join('\n');
}

export function main(argv, streams = { out: process.stdout, err: process.stderr }) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    streams.err.write(`${renderError(error, requestedFormat(argv))}\n`);
    return EXIT_INPUT_ERROR;
  }

  let report;
  try {
    report = evaluateRepositoryLifecycle(options.repoRoot);
  } catch (error) {
    if (error instanceof RepositoryLifecycleInputError) {
      streams.err.write(`${renderError(error, options.format)}\n`);
      return EXIT_INPUT_ERROR;
    }
    throw error;
  }

  streams.out.write(`${options.format === 'json' ? JSON.stringify(report, null, 2) : renderText(report)}\n`);
  return report.mismatch_count === 0 ? EXIT_PARITY : EXIT_MISMATCH;
}

// Node resolves `import.meta.url` through symlinks but leaves process.argv[1] as the
// caller spelled it, so comparing the two raw strings silently turns the command into a
// no-op (exit 0, no output) whenever it is reached through a junction -- which is exactly
// how this repository's worktrees are laid out.
function isInvokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const selfPath = fileURLToPath(import.meta.url);
  const canonical = (target) => {
    try {
      return realpathSync.native(target);
    } catch {
      return path.resolve(target);
    }
  };
  return canonical(entry) === canonical(selfPath);
}

if (isInvokedDirectly()) {
  process.exitCode = main(process.argv.slice(2));
}
