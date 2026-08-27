import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupOrphanDevProcesses,
  cleanupStaleLocks,
  evaluateOrphanCandidate,
  listBoardRegisteredWorktreePaths,
  listGitWorktreeRecords,
  listWindowsProcessSnapshots,
  parseGitWorktreeRecords,
  terminateWindowsProcessExact,
  triggerOrphanCleanup,
} from '../dev/cleanup-orphan-dev-processes.mjs';
import {
  PR_QUEUE_LOCK_REF,
  PR_QUEUE_LOCK_SCHEMA,
} from '../dev/pr-queue-lock.mjs';

function withTempDir(t, prefix) {
  const createdDirectory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const directory = fs.realpathSync.native(createdDirectory);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function initGitRepo(t, prefix) {
  const repo = path.join(withTempDir(t, prefix), 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeLock(repo, overrides = {}) {
  const record = {
    schema_version: PR_QUEUE_LOCK_SCHEMA,
    pid: 4242,
    owner_token: randomUUID(),
    creation_identity: 'fixture-process:4242',
    created_at: '2000-01-01T00:00:00.000Z',
    ...overrides,
  };
  const objectId = execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo,
    encoding: 'utf8',
    input: `${JSON.stringify(record)}\n`,
  }).trim();
  execFileSync('git', ['update-ref', PR_QUEUE_LOCK_REF, objectId, '0'.repeat(40)], {
    cwd: repo,
  });
  return record;
}

function lockExists(repo) {
  try {
    execFileSync('git', ['rev-parse', '--verify', PR_QUEUE_LOCK_REF], {
      cwd: repo,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function coordinatorSnapshot({ pid = 100, parentPid = 90, root, createdAt }) {
  return {
    pid,
    parent_pid: parentPid,
    name: 'node.exe',
    command_line: `node "${path.join(root, 'bim-review-coordinator', 'node_modules', 'tsx', 'dist', 'cli.mjs')}" src/index.ts`,
    executable_path: 'C:\\Program Files\\nodejs\\node.exe',
    creation_identity: createdAt,
  };
}

function prunableWorktree(pathValue) {
  return { path: pathValue, prunable: true, prunableReason: 'gitdir file points to missing location' };
}

test('an old lock with a live, identity-matched owner is preserved', (t) => {
  const repo = initGitRepo(t, 'cleanup-lock-live-');
  writeLock(repo);
  const cleaned = cleanupStaleLocks(repo, {
    isPidAliveImpl: () => true,
    getProcessCreationIdentityImpl: () => 'fixture-process:4242',
  });
  assert.equal(cleaned, 0);
  assert.equal(lockExists(repo), true);
});

test('a dead valid Git-ref lock is reclaimed', (t) => {
  const repo = initGitRepo(t, 'cleanup-lock-dead-');
  writeLock(repo);
  assert.equal(cleanupStaleLocks(repo, { isPidAliveImpl: () => false }), 1);
  assert.equal(lockExists(repo), false);
});

test('only a stable, old, parentless process from a deleted owned worktree is eligible', (t) => {
  const container = withTempDir(t, 'cleanup-owned-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const processSnapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  const decision = evaluateOrphanCandidate(processSnapshot, { ...processSnapshot }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  });
  assert.deepEqual(
    { eligible: decision.eligible, reason: decision.reason, role: decision.role },
    { eligible: true, reason: 'owned_deleted_worktree_orphan', role: 'coordinator' },
  );

  fs.mkdirSync(deletedRoot, { recursive: true });
  assert.equal(evaluateOrphanCandidate(processSnapshot, { ...processSnapshot }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  }).reason, 'worktree_still_exists');
});

test('an unregistered deleted sibling worktree is not mistaken for the live repository root', (t) => {
  const container = withTempDir(t, 'cleanup-unregistered-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const processSnapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });

  const decision = evaluateOrphanCandidate(processSnapshot, { ...processSnapshot }, {
    repoRoot,
    worktreePaths: [repoRoot],
    isPidAliveImpl: () => false,
    nowMs,
  });

  assert.deepEqual(
    { eligible: decision.eligible, ownedRoot: decision.ownedRoot, reason: decision.reason },
    { eligible: false, ownedRoot: undefined, reason: 'repo_ownership_unproven' },
  );
});

test('Git porcelain is the only source that can mark a worktree prunable', (t) => {
  const container = withTempDir(t, 'cleanup-porcelain-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired\n特殊 \u00a0');
  const records = parseGitWorktreeRecords([
    `worktree ${repoRoot}`,
    `HEAD ${'a'.repeat(40)}`,
    'branch refs/heads/main',
    '',
    `worktree ${deletedRoot}`,
    `HEAD ${'b'.repeat(40)}`,
    'branch refs/heads/retired',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\0'));
  assert.deepEqual(records, [
    { path: path.resolve(repoRoot), prunable: false, prunableReason: '' },
    {
      path: path.resolve(deletedRoot),
      prunable: true,
      prunableReason: 'gitdir file points to non-existent location',
    },
  ]);
});

test('worktree inventory requests NUL framing and strips ambient Git selectors', (t) => {
  const repoRoot = path.join(withTempDir(t, 'cleanup-inventory-env-'), 'repo');
  let invocation;
  const records = listGitWorktreeRecords(repoRoot, {
    env: {
      Path: 'fixture',
      GIT_DIR: 'C:\\untrusted\\.git',
      git_work_tree: 'C:\\untrusted',
    },
    execFileSyncImpl: (...args) => {
      invocation = args;
      return `worktree ${repoRoot}\0HEAD ${'a'.repeat(40)}\0\0`;
    },
  });
  assert.deepEqual(invocation[1], ['worktree', 'list', '--porcelain', '-z']);
  assert.deepEqual(invocation[2].env, { Path: 'fixture' });
  assert.deepEqual(records, [
    { path: path.resolve(repoRoot), prunable: false, prunableReason: '' },
  ]);
});

test('real Git porcelain marks only the removed disposable linked worktree prunable', (t) => {
  const container = withTempDir(t, 'cleanup-real-porcelain-');
  const repoRoot = path.join(container, 'repo');
  const linked = path.join(container, 'linked');
  fs.mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repoRoot });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['worktree', 'add', '-b', 'fixture-linked', linked], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  fs.rmSync(linked, { recursive: true, force: true });

  const records = listGitWorktreeRecords(repoRoot);
  const canonical = records.find((record) => record.path === path.resolve(repoRoot));
  const removed = records.find((record) => record.path === path.resolve(linked));
  assert.equal(canonical?.prunable, false);
  assert.equal(removed?.prunable, true);
});

test('shared board registrations are candidate hints but never destructive authority', (t) => {
  const container = withTempDir(t, 'cleanup-board-ownership-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  const unrelated = path.join(container, 'unrelated', 'bait');
  const boardDir = path.join(repoRoot, '.agents', 'board');
  const sessionsDir = path.join(boardDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, 'codex--owned.json'), JSON.stringify({ cwd: deletedRoot }));
  fs.writeFileSync(path.join(sessionsDir, 'codex--bait.json'), JSON.stringify({ cwd: unrelated }));
  fs.writeFileSync(path.join(sessionsDir, 'codex--broken.json'), '{partial');
  assert.deepEqual(listBoardRegisteredWorktreePaths(boardDir, repoRoot), [deletedRoot]);

  const nowMs = Date.now();
  const snapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  const decision = evaluateOrphanCandidate(snapshot, { ...snapshot }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [{ path: repoRoot, prunable: false }],
    isPidAliveImpl: () => false,
    nowMs,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'worktree_not_git_prunable');
});

test('case-colliding worktrees cannot transfer prunable authority to a live process', (t) => {
  const container = withTempDir(t, 'cleanup-case-collision-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const staleRoot = path.join(container, 'AI-BIM-governance.worktrees', 'Foo');
  const liveRoot = path.join(container, 'AI-BIM-governance.worktrees', 'foo');
  const nowMs = Date.now();
  const snapshot = coordinatorSnapshot({
    root: liveRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  const decision = evaluateOrphanCandidate(snapshot, { ...snapshot }, {
    repoRoot,
    worktreePaths: [staleRoot, liveRoot],
    worktreeRecords: [
      prunableWorktree(staleRoot),
      { path: liveRoot, prunable: false, prunableReason: '' },
    ],
    fsImpl: {
      lstatSync(candidate) {
        if (candidate === liveRoot) return { isDirectory: () => true };
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      },
    },
    isPidAliveImpl: () => false,
    nowMs,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.ownedRoot, liveRoot);
  assert.equal(decision.reason, 'worktree_not_git_prunable');
});

test('only exact ENOENT satisfies the deleted-path gate', (t) => {
  const container = withTempDir(t, 'cleanup-path-state-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const snapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  const base = {
    repoRoot,
    worktreePaths: [deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  };
  const denied = evaluateOrphanCandidate(snapshot, { ...snapshot }, {
    ...base,
    fsImpl: {
      lstatSync() {
        const error = new Error('access denied');
        error.code = 'EACCES';
        throw error;
      },
    },
  });
  assert.equal(denied.eligible, false);
  assert.equal(denied.reason, 'worktree_path_state_unknown');

  const symlinkLike = evaluateOrphanCandidate(snapshot, { ...snapshot }, {
    ...base,
    fsImpl: { lstatSync: () => ({ isSymbolicLink: () => true }) },
  });
  assert.equal(symlinkLike.eligible, false);
  assert.equal(symlinkLike.reason, 'worktree_still_exists');
});

test('identity drift, live parents, and unrelated tsx commands are rejected', (t) => {
  const container = withTempDir(t, 'cleanup-reject-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const first = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  assert.equal(evaluateOrphanCandidate(first, { ...first, creation_identity: new Date(nowMs - 59_000).toISOString() }, {
    repoRoot,
    worktreePaths: [deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  }).reason, 'creation_identity_unstable');
  assert.equal(evaluateOrphanCandidate(first, { ...first }, {
    repoRoot,
    worktreePaths: [deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => true,
    nowMs,
  }).reason, 'parent_still_alive');

  const unrelated = {
    ...first,
    command_line: 'node C:\\other\\node_modules\\tsx\\dist\\cli.mjs src/index.ts',
  };
  assert.equal(evaluateOrphanCandidate(unrelated, { ...unrelated }, {
    repoRoot,
    worktreePaths: [deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  }).reason, 'unsupported_process_role');
});

test('repo path bait cannot bind unrelated coordinator, Kit, or git processes', (t) => {
  const container = withTempDir(t, 'cleanup-path-bait-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const creation = new Date(nowMs - 60_000).toISOString();
  const candidates = [
    {
      pid: 301,
      parent_pid: 291,
      name: 'node.exe',
      command_line: `node C:\\unrelated\\server.js --note "${path.join(deletedRoot, 'bim-review-coordinator', 'node_modules', 'tsx', 'dist', 'cli.mjs')} src/index.ts"`,
      executable_path: 'C:\\Program Files\\nodejs\\node.exe',
      creation_identity: creation,
    },
    {
      pid: 302,
      parent_pid: 292,
      name: 'kit.exe',
      command_line: `C:\\unrelated\\kit.exe --log-dir "${path.join(deletedRoot, 'bim-streaming-server', 'logs')}"`,
      executable_path: 'C:\\unrelated\\kit.exe',
      creation_identity: creation,
    },
    {
      pid: 303,
      parent_pid: 293,
      name: 'git.exe',
      command_line: `git.exe -c safe.directory="${deletedRoot}" status --porcelain`,
      executable_path: 'C:\\Program Files\\Git\\cmd\\git.exe',
      creation_identity: creation,
    },
  ];

  for (const candidate of candidates) {
    const decision = evaluateOrphanCandidate(candidate, { ...candidate }, {
      repoRoot,
      worktreePaths: [repoRoot],
      isPidAliveImpl: () => false,
      nowMs,
    });
    assert.equal(decision.eligible, false, candidate.command_line);
    assert.ok(
      [
        'unsupported_process_role',
        'repo_ownership_unproven',
        'entrypoint_ownership_unproven',
      ].includes(decision.reason),
      `${candidate.command_line}: ${decision.reason}`,
    );
  }
});

test('Kit requires an exact repo-owned entrypoint while generic git needs a launch lease', (t) => {
  const container = withTempDir(t, 'cleanup-roles-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const creation = new Date(nowMs - 60_000).toISOString();
  const kit = {
    pid: 200,
    parent_pid: 190,
    name: 'kit.exe',
    command_line: `"${path.join(deletedRoot, 'bim-streaming-server', '_build', 'windows-x86_64', 'release', 'kit.exe')}"`,
    executable_path: path.join(deletedRoot, 'bim-streaming-server', '_build', 'windows-x86_64', 'release', 'kit.exe'),
    creation_identity: creation,
  };
  const git = {
    pid: 201,
    parent_pid: 191,
    name: 'git.exe',
    command_line: `git.exe -C "${deletedRoot}" status --porcelain`,
    executable_path: 'C:\\Program Files\\Git\\cmd\\git.exe',
    creation_identity: creation,
  };
  const kitDecision = evaluateOrphanCandidate(kit, { ...kit }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  });
  assert.equal(kitDecision.eligible, true);
  assert.equal(kitDecision.role, 'kit');
  const gitDecision = evaluateOrphanCandidate(git, { ...git }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  });
  assert.equal(gitDecision.eligible, false);
  assert.equal(gitDecision.reason, 'git_requires_launch_lease');
  const ambiguousGit = { ...git, command_line: 'git.exe status --porcelain' };
  assert.equal(evaluateOrphanCandidate(ambiguousGit, { ...ambiguousGit }, {
    repoRoot,
    worktreePaths: [repoRoot, deletedRoot],
    worktreeRecords: [prunableWorktree(deletedRoot)],
    isPidAliveImpl: () => false,
    nowMs,
  }).reason, 'unsupported_process_role');
});

test('Windows termination adapter revalidates identity and uses an exact process handle', () => {
  const expected = {
    pid: 333,
    parent_pid: 222,
    name: 'node.exe',
    command_line: 'fixture',
    executable_path: 'C:\\fixture\\node.exe',
    creation_identity: '2026-08-26T01:02:03.0000000Z',
    owned_root: 'C:\\fixture\\deleted-worktree',
  };
  let invocation;
  assert.equal(terminateWindowsProcessExact(expected, {
    execFileSyncImpl: (...args) => {
      invocation = args;
      return '';
    },
  }), true);
  const commandText = invocation[1][invocation[1].indexOf('-Command') + 1];
  assert.match(commandText, /Get-CimInstance Win32_Process/);
  assert.match(commandText, /SafeProcessHandle/);
  assert.match(commandText, /OpenProcess/);
  assert.match(commandText, /GetProcessTimes/);
  assert.match(commandText, /GetFileAttributesW/);
  assert.match(commandText, /GetLastWin32Error/);
  assert.match(commandText, /\$pathError -ne 2 -and \$pathError -ne 3/);
  assert.match(commandText, /ToFileTimeUtc/);
  assert.match(commandText, /\[Math\]::Abs\(\$actualTicks - \$expectedTicks\) -gt \[TimeSpan\]::TicksPerMillisecond/);
  assert.match(commandText, /TerminateProcess\(\$handle, 1\)/);
  assert.match(commandText, /\$handle\.Dispose\(\)/);
  assert.doesNotMatch(commandText, /Stop-Process/);
  assert.deepEqual(JSON.parse(invocation[2].env.AI_BIM_CLEANUP_EXPECTED_PROCESS), expected);
});

test('Windows native handle adapter compiles without targeting a live process', {
  skip: process.platform !== 'win32',
}, () => {
  let stderr = '';
  const result = terminateWindowsProcessExact({
    pid: 2147483647,
    parent_pid: 0,
    name: 'fixture.exe',
    command_line: 'fixture',
    executable_path: 'C:\\fixture\\fixture.exe',
    creation_identity: '2000-01-01T00:00:00.0000000Z',
    owned_root: 'C:\\fixture\\deleted-worktree',
  }, {
    execFileSyncImpl: (command, args, options) => {
      try {
        return execFileSync(command, args, {
          ...options,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        stderr = String(error?.stderr || '');
        throw error;
      }
    },
  });
  assert.equal(result, false);
  assert.doesNotMatch(stderr, /error CS|Add-Type/i);
});

test('Windows exact identity denies a mismatch and terminates only the disposable child generation', {
  skip: process.platform !== 'win32',
  timeout: 20_000,
}, async (t) => {
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore', windowsHide: true },
  );
  t.after(() => {
    try {
      child.kill();
    } catch {
      // The exact-identity path already terminated the disposable child.
    }
  });

  let snapshot = null;
  for (let attempt = 0; attempt < 30 && !snapshot; attempt += 1) {
    snapshot = listWindowsProcessSnapshots().find((item) => item.pid === child.pid) || null;
    if (!snapshot) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(snapshot, `missing process snapshot for disposable PID ${child.pid}`);
  assert.ok(snapshot.creation_identity);

  const restoredRoot = withTempDir(t, 'cleanup-restored-native-');
  const expected = {
    ...snapshot,
    owned_root: path.join(restoredRoot, 'missing-worktree'),
  };
  assert.equal(terminateWindowsProcessExact({
    ...snapshot,
    owned_root: restoredRoot,
  }), false);
  assert.doesNotThrow(() => process.kill(child.pid, 0));

  const wrongIdentity = {
    ...expected,
    creation_identity: '2000-01-01T00:00:00.0000000Z',
  };
  assert.equal(terminateWindowsProcessExact(wrongIdentity), false);
  assert.doesNotThrow(() => process.kill(child.pid, 0));

  const exited = new Promise((resolve) => child.once('exit', resolve));
  assert.equal(terminateWindowsProcessExact(expected), true);
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`disposable PID ${child.pid} did not exit`)),
      5_000,
    )),
  ]);
  assert.notEqual(child.exitCode, null);
});

test('cleanup orchestration is fully injectable and never touches live machine state', (t) => {
  const container = withTempDir(t, 'cleanup-orchestration-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'retired');
  const boardDir = path.join(container, 'board');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const snapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  let inventoryCalls = 0;
  let worktreeInventoryCalls = 0;
  const terminated = [];
  let pruneCalls = 0;
  const result = cleanupOrphanDevProcesses({
    platform: 'win32',
    repoRoot,
    boardDir,
    listProcessesImpl: () => {
      inventoryCalls += 1;
      return [{ ...snapshot }];
    },
    listWorktreesImpl: () => {
      worktreeInventoryCalls += 1;
      return [
        { path: repoRoot, prunable: false },
        prunableWorktree(deletedRoot),
      ];
    },
    terminateProcessImpl: (expected) => {
      terminated.push(expected);
      return true;
    },
    isPidAliveImpl: () => false,
    nowMs,
    pruneOptions: {
      execFileSyncImpl: () => {
        pruneCalls += 1;
        return '';
      },
    },
  });
  assert.equal(inventoryCalls, 2);
  assert.equal(worktreeInventoryCalls, 2);
  assert.equal(pruneCalls, 1);
  assert.equal(terminated.length, 1);
  assert.equal(result.killed.length, 1);
  assert.equal(result.errors.length, 0);
});

test('cleanup revalidates deleted-worktree provenance immediately before termination', (t) => {
  const container = withTempDir(t, 'cleanup-stop-provenance-');
  const repoRoot = path.join(container, 'AI-BIM-governance');
  const deletedRoot = path.join(container, 'AI-BIM-governance.worktrees', 'restored-race');
  fs.mkdirSync(repoRoot, { recursive: true });
  const nowMs = Date.now();
  const snapshot = coordinatorSnapshot({
    root: deletedRoot,
    createdAt: new Date(nowMs - 60_000).toISOString(),
  });
  let lstatCalls = 0;
  let terminated = false;
  const fsImpl = {
    ...fs,
    lstatSync: () => {
      lstatCalls += 1;
      if (lstatCalls === 1) {
        const error = new Error('missing during first evaluation');
        error.code = 'ENOENT';
        throw error;
      }
      return {};
    },
  };
  const result = cleanupOrphanDevProcesses({
    platform: 'win32',
    repoRoot,
    boardDir: path.join(container, 'board'),
    fsImpl,
    listProcessesImpl: () => [{ ...snapshot }],
    listWorktreesImpl: () => [
      { path: repoRoot, prunable: false },
      prunableWorktree(deletedRoot),
    ],
    terminateProcessImpl: () => {
      terminated = true;
      return true;
    },
    isPidAliveImpl: () => false,
    nowMs,
    pruneOptions: { execFileSyncImpl: () => '' },
  });
  assert.equal(lstatCalls, 2);
  assert.equal(terminated, false);
  assert.equal(result.killed.length, 0);
  assert.equal(result.skipped.at(-1)?.reason, 'stop_worktree_restored');
});

test('background trigger only spawns the isolated cleanup entrypoint', () => {
  const calls = [];
  const child = { unrefCalled: false, unref() { this.unrefCalled = true; } };
  const triggered = triggerOrphanCleanup(true, {
    repoRoot: 'C:\\fixture\\repo',
    spawnImpl: (...args) => {
      calls.push(args);
      return child;
    },
  });
  assert.equal(triggered, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1].includes('--silent'));
  assert.equal(child.unrefCalled, true);
});
