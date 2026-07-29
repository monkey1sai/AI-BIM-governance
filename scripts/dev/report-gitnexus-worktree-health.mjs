#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateGitNexusWorktreeHealth,
  gitNexusWorktreeHealthVersions,
  normalizeRepositoryPath,
} from '../lib/gitnexus-worktree-health.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = dirname(scriptPath);

function parseArguments(argv) {
  const parsed = { observation: null, gitnexusObservation: null, format: 'json' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--observation' || argument === '--gitnexus-observation' || argument === '--format') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--observation') parsed.observation = value;
      else if (argument === '--gitnexus-observation') parsed.gitnexusObservation = value;
      else parsed.format = value;
      continue;
    }
    throw new Error(`unknown argument ${argument}`);
  }
  if (parsed.format !== 'json') throw new Error('only --format json is supported');
  if (parsed.observation !== null && parsed.gitnexusObservation !== null) {
    throw new Error('--observation and --gitnexus-observation are mutually exclusive');
  }
  return parsed;
}

function loadJson(path) {
  const resolvedPath = resolve(path);
  const stats = statSync(resolvedPath);
  if (!stats.isFile() || stats.size > 2 * 1024 * 1024) throw new Error('observation must be a regular JSON file no larger than 2 MiB');
  return JSON.parse(readFileSync(resolvedPath, 'utf8'));
}

function findRepositoryRoot(startPath) {
  let candidate = resolve(startPath);
  while (true) {
    if (existsSync(resolve(candidate, '.git'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('current directory is not inside a Git worktree');
    candidate = parent;
  }
}

function runGit(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', ['-c', `safe.directory=${repositoryRoot.replace(/\\/g, '/')}`, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (allowFailure) return null;
    const detail = String(result.stderr || '').trim().split(/\r?\n/, 1)[0];
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

export function parseWorktreePorcelain(output) {
  const records = String(output).trim().split(/\r?\n\r?\n/).filter(Boolean);
  return records.map((record) => {
    const result = { path: null, head_sha: null, branch: null, locked: false, prunable: false };
    for (const line of record.split(/\r?\n/)) {
      const separator = line.indexOf(' ');
      const key = separator === -1 ? line : line.slice(0, separator);
      const value = separator === -1 ? '' : line.slice(separator + 1);
      if (key === 'worktree') result.path = value;
      else if (key === 'HEAD') result.head_sha = value;
      else if (key === 'branch') result.branch = value;
      else if (key === 'detached') result.branch = null;
      else if (key === 'locked') result.locked = true;
      else if (key === 'prunable') result.prunable = true;
    }
    if (result.path === null || result.head_sha === null) throw new Error('git worktree record is missing path or HEAD');
    return result;
  });
}

function repositoryNameFromRemote(repositoryRoot) {
  const remote = runGit(repositoryRoot, ['remote', 'get-url', 'origin'], { allowFailure: true });
  if (remote) {
    const withoutSuffix = remote.replace(/[\\/]$/, '').replace(/\.git$/i, '');
    const segments = withoutSuffix.split(/[\\/:]/).filter(Boolean);
    if (segments.length > 0) return segments.at(-1);
  }
  return basename(repositoryRoot);
}

function loadAgentBoard(repositoryRoot) {
  const boardScript = resolve(repositoryRoot, 'scripts', 'dev', 'agents-board.mjs');
  const result = spawnSync(process.execPath, [boardScript, 'status', '--json', '--no-prune'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { available: false, sessions: [] };
  try {
    const parsed = JSON.parse(result.stdout);
    return { available: true, sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch {
    return { available: false, sessions: [] };
  }
}

function ownerForPath(board, worktreePath) {
  if (!board.available) return { owner: null, owner_status: 'unknown', last_activity: null };
  const key = normalizeRepositoryPath(worktreePath);
  const rank = { active: 0, idle: 1, ended: 2 };
  const candidates = board.sessions
    .filter((session) => typeof session.cwd === 'string' && normalizeRepositoryPath(session.cwd) === key)
    .sort((left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9)
      || Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0));
  const selected = candidates[0];
  if (!selected) return { owner: null, owner_status: 'unclaimed', last_activity: null };
  const status = ['active', 'idle', 'ended'].includes(selected.status) ? selected.status : 'unknown';
  return {
    owner: typeof selected.agent === 'string' && selected.agent.length > 0 ? selected.agent : null,
    owner_status: typeof selected.agent === 'string' && selected.agent.length > 0 ? status : 'unknown',
    last_activity: Number.isFinite(Date.parse(selected.updatedAt)) ? new Date(selected.updatedAt).toISOString() : null,
  };
}

export function collectRepositoryObservation(repositoryRoot, gitnexus = null) {
  const root = findRepositoryRoot(repositoryRoot);
  const currentPath = runGit(root, ['rev-parse', '--show-toplevel']);
  const head = runGit(root, ['rev-parse', 'HEAD']);
  const branch = runGit(root, ['symbolic-ref', '-q', 'HEAD'], { allowFailure: true });
  const originMain = runGit(root, ['rev-parse', '--verify', 'refs/remotes/origin/main'], { allowFailure: true });
  const dirty = runGit(root, ['status', '--porcelain=v1', '-z']) !== '';
  const board = loadAgentBoard(root);
  const worktrees = parseWorktreePorcelain(runGit(root, ['worktree', 'list', '--porcelain'])).map((worktree) => {
    const isCurrent = normalizeRepositoryPath(worktree.path) === normalizeRepositoryPath(currentPath);
    return {
      ...worktree,
      dirty: isCurrent ? dirty : null,
      ...ownerForPath(board, worktree.path),
    };
  });
  return {
    schema_version: gitNexusWorktreeHealthVersions.observation,
    repository_name: repositoryNameFromRemote(root),
    current_checkout: { path: currentPath, head_sha: head, origin_main_sha: originMain, branch, dirty },
    worktrees,
    gitnexus,
  };
}

function emitError(error) {
  const payload = {
    schema_version: 'gitnexus-worktree-health-error/v1',
    overall_status: 'unhealthy',
    error: { code: 'health_collection_failed', message: String(error?.message || error) },
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = 2;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArguments(argv);
    let observation;
    if (args.observation !== null) observation = loadJson(args.observation);
    else {
      const gitnexus = args.gitnexusObservation === null ? null : loadJson(args.gitnexusObservation);
      observation = collectRepositoryObservation(process.cwd(), gitnexus);
    }
    const report = evaluateGitNexusWorktreeHealth(observation);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.overall_status === 'unknown' || report.overall_status === 'unhealthy') process.exitCode = 2;
    else if (report.overall_status === 'warning') process.exitCode = 1;
  } catch (error) {
    emitError(error);
  }
}

if (resolve(process.argv[1] || '') === scriptPath) main();
