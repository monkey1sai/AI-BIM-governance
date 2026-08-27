#!/usr/bin/env node
// Fail-closed cleanup for repo-owned development processes and PR queue residue.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildGitArgs,
  buildIsolatedGitEnv,
  resolveCanonicalRepoRoot,
  resolveSharedBoardDir,
} from './agents-board-path.mjs';
import {
  cleanupStalePrQueueLock,
  isPidAlive,
} from './pr-queue-lock.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const DEFAULT_REPO_ROOT = resolveCanonicalRepoRoot(SCRIPT_REPO_ROOT) || SCRIPT_REPO_ROOT;
const DEFAULT_MINIMUM_AGE_MS = 30_000;

function normalizeProcessSnapshot(raw) {
  return {
    pid: Number(raw?.pid ?? raw?.ProcessId ?? 0),
    parent_pid: Number(raw?.parent_pid ?? raw?.ParentProcessId ?? 0),
    name: String(raw?.name ?? raw?.Name ?? ''),
    command_line: String(raw?.command_line ?? raw?.CommandLine ?? ''),
    executable_path: String(raw?.executable_path ?? raw?.ExecutablePath ?? ''),
    creation_identity: String(raw?.creation_identity ?? raw?.CreationDate ?? ''),
  };
}

export function listWindowsProcessSnapshots(
  { execFileSyncImpl = execFileSync } = {},
) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Get-CimInstance Win32_Process | ForEach-Object {',
    '  [pscustomobject]@{',
    '    pid = [int]$_.ProcessId',
    '    parent_pid = [int]$_.ParentProcessId',
    '    name = [string]$_.Name',
    '    command_line = [string]$_.CommandLine',
    '    executable_path = [string]$_.ExecutablePath',
    "    creation_identity = if ($null -ne $_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }",
    '  }',
    '} | ConvertTo-Json -Compress -Depth 3',
  ].join('\n');
  const raw = execFileSyncImpl(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  ).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]).map(normalizeProcessSnapshot);
}

export function parseGitWorktreeRecords(raw) {
  const records = [];
  let current = null;
  const finishCurrent = () => {
    if (current?.path) records.push(current);
    current = null;
  };
  const text = String(raw || '');
  const fields = text.includes('\0') ? text.split('\0') : text.split(/\r?\n/);
  for (const line of fields) {
    if (line.startsWith('worktree ')) {
      finishCurrent();
      const candidate = line.slice('worktree '.length);
      current = candidate
        ? { path: path.resolve(candidate), prunable: false, prunableReason: '' }
        : null;
    } else if (current && /^prunable(?:\s|$)/.test(line)) {
      current.prunable = true;
      current.prunableReason = line.slice('prunable'.length).replace(/^ /, '');
    } else if (!line && current) {
      finishCurrent();
    }
  }
  finishCurrent();
  return records;
}

export function listGitWorktreeRecords(
  repoRoot = DEFAULT_REPO_ROOT,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  try {
    const raw = execFileSyncImpl(
      'git',
      buildGitArgs(['worktree', 'list', '--porcelain', '-z']),
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: buildIsolatedGitEnv(env),
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return parseGitWorktreeRecords(raw);
  } catch {
    return [{ path: path.resolve(repoRoot), prunable: false, prunableReason: '' }];
  }
}

export function listGitWorktreePaths(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  return listGitWorktreeRecords(repoRoot, options).map((record) => record.path);
}

export function listBoardRegisteredWorktreePaths(
  boardDir,
  repoRoot = DEFAULT_REPO_ROOT,
  { fsImpl = fs } = {},
) {
  if (!boardDir) return [];
  const sessionsDir = path.join(boardDir, 'sessions');
  const siblingContainer = path.resolve(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}.worktrees`,
  );
  const result = new Set();
  let entries = [];
  try {
    entries = fsImpl.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const record = JSON.parse(fsImpl.readFileSync(path.join(sessionsDir, entry.name), 'utf8'));
      if (typeof record?.cwd !== 'string' || !record.cwd) continue;
      const candidate = path.resolve(record.cwd);
      if (normalizePathForCompare(path.dirname(candidate)) !== normalizePathForCompare(siblingContainer)) continue;
      if (!path.basename(candidate) || ['.', '..'].includes(path.basename(candidate))) continue;
      result.add(candidate);
    } catch {
      // Malformed board records never grant process ownership.
    }
  }
  return [...result];
}

export function findOwnedWorktreeRoot(
  snapshot,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    worktreePaths = [],
  } = {},
) {
  const combined = `${snapshot.command_line}\n${snapshot.executable_path}`;
  const normalizedCombined = combined.replace(/\\/g, '/');
  const roots = [repoRoot, ...worktreePaths]
    .filter(Boolean)
    .map((root) => path.resolve(root))
    .sort((left, right) => right.length - left.length);
  for (const root of roots) {
    const needle = root.replace(/\\/g, '/');
    let index = normalizedCombined.indexOf(needle);
    while (index >= 0) {
      const before = index > 0 ? normalizedCombined[index - 1] : '';
      const afterIndex = index + needle.length;
      const after = afterIndex < normalizedCombined.length ? normalizedCombined[afterIndex] : '';
      const startsAtPathBoundary = !before || /[\s"'=]/.test(before);
      const endsAtPathBoundary = !after || /[\/\s"']/.test(after);
      if (startsAtPathBoundary && endsAtPathBoundary) return root;
      index = normalizedCombined.indexOf(needle, index + 1);
    }
  }
  return '';
}

function tokenizeCommandLine(commandLine) {
  return (String(commandLine).match(/"[^"]*"|'[^']*'|\S+/g) || []).map((token) => {
    if (
      token.length >= 2
      && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function normalizePathForCompare(value) {
  return path.resolve(String(value)).replace(/[\\/]+$/, '');
}

function isPathInside(candidate, root) {
  const normalizedCandidate = normalizePathForCompare(candidate);
  const normalizedRoot = normalizePathForCompare(root);
  return (
    normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

function isRoleBoundToOwnedEntrypoint(snapshot, role, ownedRoot) {
  const tokens = tokenizeCommandLine(snapshot.command_line);
  if (role === 'coordinator') {
    if (tokens.length < 3) return false;
    const expectedTsxRoot = path.join(
      ownedRoot,
      'bim-review-coordinator',
      'node_modules',
      'tsx',
    );
    const scriptToken = tokens[1];
    const sourceToken = tokens[2].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    const absoluteSource = path.join(ownedRoot, 'bim-review-coordinator', 'src', 'index.ts');
    return (
      isPathInside(scriptToken, expectedTsxRoot)
      && path.basename(scriptToken).toLowerCase() === 'cli.mjs'
      && (
        sourceToken === 'src/index.ts'
        || normalizePathForCompare(tokens[2]) === normalizePathForCompare(absoluteSource)
      )
    );
  }
  if (role === 'kit') {
    const executable = snapshot.executable_path;
    if (!executable) return false;
    const serviceRoot = path.join(ownedRoot, 'bim-streaming-server');
    const executableName = path.basename(executable).toLowerCase();
    return isPathInside(executable, serviceRoot) && ['kit', 'kit.exe'].includes(executableName);
  }
  return false;
}

export function classifyDevProcessRole(snapshot) {
  const name = snapshot.name.toLowerCase();
  const command = snapshot.command_line.replace(/\\/g, '/').toLowerCase();
  const executable = snapshot.executable_path.replace(/\\/g, '/').toLowerCase();
  const isNode = name === 'node.exe' || name === 'node';
  const exactTsxEntrypoint = (
    command.includes('bim-review-coordinator')
    && command.includes('src/index.ts')
    && (
      command.includes('node_modules/tsx/')
      || /(?:^|[\s/])tsx(?:\.cmd)?(?:\s|$)/.test(command)
    )
  );
  if (isNode && exactTsxEntrypoint) return 'coordinator';

  const isKit = name === 'kit.exe' || name === 'kit';
  if (
    isKit
    && `${command}\n${executable}`.includes('bim-streaming-server')
    && (command.includes('kit.exe') || executable.endsWith('/kit.exe') || executable.endsWith('/kit'))
  ) {
    return 'kit';
  }

  const isGit = name === 'git.exe' || name === 'git';
  const tokens = tokenizeCommandLine(snapshot.command_line);
  if (isGit && tokens.some((token, index) => (
    (token === '-C' && Boolean(tokens[index + 1]))
    || (token.startsWith('-C=') && token.length > 3)
  ))) {
    return 'git';
  }
  return '';
}

export function sameProcessIdentity(left, right) {
  if (!left || !right) return false;
  return (
    left.pid === right.pid
    && left.parent_pid === right.parent_pid
    && left.name === right.name
    && left.command_line === right.command_line
    && left.executable_path === right.executable_path
    && left.creation_identity === right.creation_identity
  );
}

export function evaluateOrphanCandidate(
  first,
  second,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    worktreePaths = [],
    worktreeRecords = [],
    fsImpl = fs,
    isPidAliveImpl = isPidAlive,
    nowMs = Date.now(),
    minimumAgeMs = DEFAULT_MINIMUM_AGE_MS,
  } = {},
) {
  const role = classifyDevProcessRole(first);
  if (!role) return { eligible: false, reason: 'unsupported_process_role' };
  if (!sameProcessIdentity(first, second)) {
    return { eligible: false, reason: 'creation_identity_unstable', role };
  }
  if (role === 'git') {
    return { eligible: false, reason: 'git_requires_launch_lease', role };
  }
  const ownedRoot = findOwnedWorktreeRoot(first, { repoRoot, worktreePaths });
  if (!ownedRoot) return { eligible: false, reason: 'repo_ownership_unproven', role };
  if (!isRoleBoundToOwnedEntrypoint(first, role, ownedRoot)) {
    return { eligible: false, reason: 'entrypoint_ownership_unproven', role, ownedRoot };
  }
  const gitRecord = worktreeRecords.find((record) => (
    record
    && typeof record.path === 'string'
    && normalizePathForCompare(record.path) === normalizePathForCompare(ownedRoot)
  ));
  if (!gitRecord?.prunable) {
    return { eligible: false, reason: 'worktree_not_git_prunable', role, ownedRoot };
  }
  try {
    fsImpl.lstatSync(ownedRoot);
    return { eligible: false, reason: 'worktree_still_exists', role, ownedRoot };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { eligible: false, reason: 'worktree_path_state_unknown', role, ownedRoot };
    }
  }
  if (isPidAliveImpl(first.parent_pid)) {
    return { eligible: false, reason: 'parent_still_alive', role, ownedRoot };
  }
  const createdAt = Date.parse(first.creation_identity);
  if (Number.isNaN(createdAt)) {
    return { eligible: false, reason: 'creation_identity_missing', role, ownedRoot };
  }
  if (nowMs - createdAt < minimumAgeMs) {
    return { eligible: false, reason: 'minimum_age_not_reached', role, ownedRoot };
  }
  return { eligible: true, reason: 'owned_deleted_worktree_orphan', role, ownedRoot };
}

export function revalidateDeletedWorktreeProvenance(
  ownedRoot,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    listWorktreesImpl = listGitWorktreeRecords,
    fsImpl = fs,
  } = {},
) {
  let records;
  try {
    records = listWorktreesImpl(repoRoot);
  } catch {
    return { eligible: false, reason: 'stop_worktree_provenance_unknown' };
  }
  const record = records.find((candidate) => (
    candidate
    && typeof candidate !== 'string'
    && candidate.prunable === true
    && typeof candidate.path === 'string'
    && normalizePathForCompare(candidate.path) === normalizePathForCompare(ownedRoot)
  ));
  if (!record) {
    return { eligible: false, reason: 'stop_worktree_not_git_prunable' };
  }
  try {
    fsImpl.lstatSync(ownedRoot);
    return { eligible: false, reason: 'stop_worktree_restored' };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { eligible: false, reason: 'stop_worktree_path_state_unknown' };
    }
  }
  return { eligible: true, reason: 'stop_provenance_revalidated' };
}

export function terminateWindowsProcessExact(
  expected,
  { execFileSyncImpl = execFileSync } = {},
) {
  if (
    typeof expected?.owned_root !== 'string'
    || !path.isAbsolute(expected.owned_root)
  ) return false;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$nativeSource = @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'using Microsoft.Win32.SafeHandles;',
    'public static class AiBimNativeProcess {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  public struct FileTime { public uint Low; public uint High; public long ToLong() { return ((long)High << 32) | Low; } }',
    '  [DllImport("kernel32.dll", SetLastError=true)]',
    '  public static extern SafeProcessHandle OpenProcess(uint access, bool inheritHandle, uint processId);',
    '  [DllImport("kernel32.dll", SetLastError=true)]',
    '  [return: MarshalAs(UnmanagedType.Bool)]',
    '  public static extern bool GetProcessTimes(SafeProcessHandle process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);',
    '  [DllImport("kernel32.dll", SetLastError=true)]',
    '  [return: MarshalAs(UnmanagedType.Bool)]',
    '  public static extern bool TerminateProcess(SafeProcessHandle process, uint exitCode);',
    '  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]',
    '  public static extern uint GetFileAttributesW(string path);',
    '}',
    "'@",
    'Add-Type -TypeDefinition $nativeSource',
    '$expected = $env:AI_BIM_CLEANUP_EXPECTED_PROCESS | ConvertFrom-Json',
    "$cim = Get-CimInstance Win32_Process -Filter ('ProcessId={0}' -f [int]$expected.pid) -ErrorAction Stop",
    "if ($null -eq $cim -or $null -eq $cim.CreationDate) { exit 20 }",
    "$creation = $cim.CreationDate.ToUniversalTime().ToString('o')",
    "if ([int]$cim.ParentProcessId -ne [int]$expected.parent_pid -or [string]$cim.Name -cne [string]$expected.name -or [string]$cim.CommandLine -cne [string]$expected.command_line -or [string]$cim.ExecutablePath -cne [string]$expected.executable_path -or $creation -cne [string]$expected.creation_identity) { exit 21 }",
    '$handle = [AiBimNativeProcess]::OpenProcess(0x1001, $false, [uint32]$expected.pid)',
    'if ($null -eq $handle -or $handle.IsInvalid) { exit 22 }',
    '$nativeExit = 0',
    'try {',
    '  $created = New-Object AiBimNativeProcess+FileTime',
    '  $exited = New-Object AiBimNativeProcess+FileTime',
    '  $kernel = New-Object AiBimNativeProcess+FileTime',
    '  $user = New-Object AiBimNativeProcess+FileTime',
    '  if (-not [AiBimNativeProcess]::GetProcessTimes($handle, [ref]$created, [ref]$exited, [ref]$kernel, [ref]$user)) {',
    '    $nativeExit = 23',
    '  } else {',
    '    $expectedTicks = ([DateTimeOffset]::Parse([string]$expected.creation_identity)).UtcDateTime.ToFileTimeUtc()',
    '    $actualTicks = $created.ToLong()',
    '    if ([Math]::Abs($actualTicks - $expectedTicks) -gt [TimeSpan]::TicksPerMillisecond) {',
    '      $nativeExit = 24',
    '    } else {',
    '      $attributes = [AiBimNativeProcess]::GetFileAttributesW([string]$expected.owned_root)',
    '      if ($attributes -ne [uint32]::MaxValue) {',
    '        $nativeExit = 26',
    '      } else {',
    '        $pathError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()',
    '        if ($pathError -ne 2 -and $pathError -ne 3) {',
    '          $nativeExit = 27',
    '        } elseif (-not [AiBimNativeProcess]::TerminateProcess($handle, 1)) {',
    '          $nativeExit = 25',
    '        }',
    '      }',
    '    }',
    '  }',
    '} finally {',
    '  $handle.Dispose()',
    '}',
    'if ($nativeExit -ne 0) { exit $nativeExit }',
  ].join('\n');
  try {
    execFileSyncImpl(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AI_BIM_CLEANUP_EXPECTED_PROCESS: JSON.stringify(expected),
        },
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export function cleanupStaleLocks(
  repoRoot = DEFAULT_REPO_ROOT,
  options = {},
) {
  if (!repoRoot) return 0;
  const result = cleanupStalePrQueueLock(repoRoot, options);
  return result.cleaned ? 1 : 0;
}

export function pruneGitWorktrees(
  repoRoot = DEFAULT_REPO_ROOT,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  try {
    execFileSyncImpl('git', buildGitArgs(['worktree', 'prune']), {
      cwd: repoRoot,
      env: buildIsolatedGitEnv(env),
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function cleanupOrphanDevProcesses(input = {}) {
  const options = typeof input === 'boolean' ? { silent: input } : input;
  const {
    silent = true,
    platform = process.platform,
    repoRoot = DEFAULT_REPO_ROOT,
    boardDir = resolveSharedBoardDir(repoRoot),
    fsImpl = fs,
    listProcessesImpl = listWindowsProcessSnapshots,
    listWorktreesImpl = listGitWorktreeRecords,
    listBoardWorktreesImpl = listBoardRegisteredWorktreePaths,
    terminateProcessImpl = terminateWindowsProcessExact,
    isPidAliveImpl = isPidAlive,
    nowMs = Date.now(),
    minimumAgeMs = DEFAULT_MINIMUM_AGE_MS,
    cleanupLockOptions = {},
    pruneOptions = {},
  } = options;
  const result = {
    killed: [],
    skipped: [],
    prunedWorktrees: false,
    staleLocksCleaned: 0,
    errors: [],
  };

  try {
    result.staleLocksCleaned = cleanupStaleLocks(repoRoot, cleanupLockOptions);
    if (platform === 'win32') {
      const worktreeRecords = listWorktreesImpl(repoRoot).map((record) => (
        typeof record === 'string'
          ? { path: path.resolve(record), prunable: false, prunableReason: '' }
          : {
            path: path.resolve(record.path),
            prunable: record.prunable === true,
            prunableReason: String(record.prunableReason || ''),
          }
      ));
      const worktreePaths = [...new Set([
        ...worktreeRecords.map((record) => record.path),
        ...listBoardWorktreesImpl(boardDir, repoRoot, { fsImpl }),
      ].map((item) => path.resolve(item)))];
      const first = listProcessesImpl().map(normalizeProcessSnapshot);
      const secondByPid = new Map(
        listProcessesImpl().map(normalizeProcessSnapshot).map((item) => [item.pid, item]),
      );
      for (const snapshot of first) {
        if (!Number.isSafeInteger(snapshot.pid) || snapshot.pid <= 0 || snapshot.pid === process.pid) continue;
        const decision = evaluateOrphanCandidate(snapshot, secondByPid.get(snapshot.pid), {
          repoRoot,
          worktreePaths,
          worktreeRecords,
          fsImpl,
          isPidAliveImpl,
          nowMs,
          minimumAgeMs,
        });
        if (!decision.eligible) {
          if (decision.reason !== 'unsupported_process_role') {
            result.skipped.push({ pid: snapshot.pid, name: snapshot.name, ...decision });
          }
          continue;
        }
        const stopProvenance = revalidateDeletedWorktreeProvenance(
          decision.ownedRoot,
          { repoRoot, listWorktreesImpl, fsImpl },
        );
        if (!stopProvenance.eligible) {
          result.skipped.push({
            pid: snapshot.pid,
            name: snapshot.name,
            ...decision,
            eligible: false,
            reason: stopProvenance.reason,
          });
          continue;
        }
        if (terminateProcessImpl({
          ...snapshot,
          owned_root: decision.ownedRoot,
        })) {
          const record = {
            pid: snapshot.pid,
            name: snapshot.name,
            role: decision.role,
            ownedRoot: decision.ownedRoot,
            creation_identity: snapshot.creation_identity,
          };
          result.killed.push(record);
          if (!silent) {
            process.stdout.write(`[cleanup-orphan-dev-processes] Terminated owned orphan ${decision.role} PID ${snapshot.pid}\n`);
          }
        } else {
          result.skipped.push({
            pid: snapshot.pid,
            name: snapshot.name,
            ...decision,
            eligible: false,
            reason: 'stop_identity_revalidation_failed',
          });
        }
      }
    }
    result.prunedWorktrees = pruneGitWorktrees(repoRoot, pruneOptions);
  } catch (error) {
    result.errors.push(String(error?.message || error));
    if (!silent) {
      process.stderr.write(`[cleanup-orphan-dev-processes] ${result.errors.at(-1)}\n`);
    }
  }
  return result;
}

export function triggerOrphanCleanup(
  nonBlocking = true,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    spawnImpl = spawn,
  } = {},
) {
  const canonicalRoot = resolveCanonicalRepoRoot(repoRoot) || repoRoot;
  if (!nonBlocking) {
    cleanupOrphanDevProcesses({ silent: true, repoRoot: canonicalRoot });
    return true;
  }
  try {
    const child = spawnImpl(process.execPath, [SCRIPT_PATH, '--silent'], {
      cwd: canonicalRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  const silent = process.argv.includes('--silent');
  const result = cleanupOrphanDevProcesses({ silent });
  if (!silent) {
    process.stdout.write(`${JSON.stringify({
      schema_version: 'orphan-dev-process-cleanup-result/v2',
      killed: result.killed,
      skipped: result.skipped,
      stale_locks_cleaned: result.staleLocksCleaned,
      pruned_worktrees: result.prunedWorktrees,
      errors: result.errors,
    })}\n`);
  }
}
