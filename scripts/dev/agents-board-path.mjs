import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

export function buildGitArgs(args) {
  return [...args];
}

export function buildIsolatedGitEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env || {}).filter(([key]) => !/^GIT_/i.test(key)),
  );
}

export function resolveGitCommonDir(
  cwd,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  try {
    return execFileSyncImpl(
      'git',
      buildGitArgs(['rev-parse', '--path-format=absolute', '--git-common-dir']),
      {
        cwd,
        encoding: 'utf8',
        env: buildIsolatedGitEnv(env),
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    return '';
  }
}

export function resolveCanonicalRepoRoot(
  cwd,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  const commonDir = resolveGitCommonDir(cwd, { execFileSyncImpl, env });
  return commonDir ? path.dirname(commonDir) : '';
}

export function resolveSharedBoardDir(
  cwd,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  const canonicalRoot = resolveCanonicalRepoRoot(cwd, { execFileSyncImpl, env });
  return canonicalRoot ? path.join(canonicalRoot, '.agents', 'board') : '';
}
