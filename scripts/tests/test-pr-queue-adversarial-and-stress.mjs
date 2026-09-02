import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildGitArgs,
  buildIsolatedGitEnv,
  resolveGitCommonDir,
  resolveSharedBoardDir,
} from '../dev/agents-board-path.mjs';
import {
  acquirePrQueueLock,
  cleanupStalePrQueueLock,
  getProcessCreationIdentity,
  isAllowedPrQueueLockGitCommand,
  PR_QUEUE_LOCK_REF,
  PR_QUEUE_LOCK_SCHEMA,
} from '../dev/pr-queue-lock.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(SCRIPT_DIR, 'fixtures', 'pr-queue-lock-worker.mjs');
const BOARD_SCRIPT = path.join(SCRIPT_DIR, '..', 'dev', 'agents-board.mjs');

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

function git(repo, args, input) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function writeLockRef(repo, record) {
  const objectId = git(repo, ['hash-object', '-w', '--stdin'], `${JSON.stringify(record)}\n`);
  git(repo, ['update-ref', PR_QUEUE_LOCK_REF, objectId, '0'.repeat(40)]);
  return objectId;
}

function readLockRef(repo) {
  try {
    return git(repo, ['rev-parse', '--verify', PR_QUEUE_LOCK_REF]);
  } catch {
    return '';
  }
}

test('Windows creation identity passes PID out-of-band and returns one timestamp', () => {
  let invocation;
  const identity = getProcessCreationIdentity(4242, {
    platform: 'win32',
    execFileSyncImpl: (...args) => {
      invocation = args;
      return '2026-08-26T01:02:03.0000000Z\r\n';
    },
  });
  assert.equal(identity, '2026-08-26T01:02:03.0000000Z');
  assert.equal(invocation[2].env.AI_BIM_PR_QUEUE_PID, '4242');
  assert.doesNotMatch(invocation[1].join(' '), /(?:^|\s)4242(?:\s|$)/);
  assert.match(invocation[1][invocation[1].indexOf('-Command') + 1], /AI_BIM_PR_QUEUE_PID/);
});

test('Linux creation identity is stable across executable replacement', () => {
  const reads = [];
  const identity = getProcessCreationIdentity(4242, {
    platform: 'linux',
    fsImpl: {
      readFileSync(file) {
        reads.push(file);
        if (file === '/proc/4242/stat') {
          const tail = ['S', ...Array.from({ length: 18 }, () => '0'), '987654', '0'];
          return `4242 (node) ${tail.join(' ')}`;
        }
        if (file === '/proc/sys/kernel/random/boot_id') {
          return '11111111-2222-3333-4444-555555555555\n';
        }
        throw new Error(`unexpected read: ${file}`);
      },
      readlinkSync() {
        throw new Error('executable path must not define process generation');
      },
    },
  });
  assert.equal(identity, 'linux:11111111-2222-3333-4444-555555555555:987654');
  assert.deepEqual(reads, [
    '/proc/4242/stat',
    '/proc/sys/kernel/random/boot_id',
  ]);
});

test('nested Git calls never alter the ownership trust boundary', () => {
  assert.deepEqual(buildGitArgs(['status', '--porcelain']), ['status', '--porcelain']);
  assert.equal(buildGitArgs(['status']).some((arg) => arg.includes('safe.directory')), false);
  assert.deepEqual(
    buildIsolatedGitEnv({
      Path: 'fixture',
      GIT_DIR: 'C:\\untrusted\\.git',
      git_work_tree: 'C:\\untrusted',
      GIT_CONFIG_COUNT: '1',
    }),
    { Path: 'fixture' },
  );
});

test('ambient Git repository selectors cannot redirect canonical resolution or lock CAS', (t) => {
  const intended = initGitRepo(t, 'queue-env-intended-');
  const unrelated = initGitRepo(t, 'queue-env-unrelated-');
  const poisonedEnv = {
    ...process.env,
    GIT_DIR: path.join(unrelated, '.git'),
    GIT_WORK_TREE: unrelated,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: 'NUL',
  };
  assert.equal(
    path.resolve(resolveGitCommonDir(intended, { env: poisonedEnv })),
    path.join(intended, '.git'),
  );
  const lock = acquirePrQueueLock({
    repoRoot: intended,
    env: poisonedEnv,
    getProcessCreationIdentityImpl: (pid) => `fixture-process:${pid}`,
  });
  assert.ok(lock);
  assert.equal(readLockRef(intended), lock.objectId);
  assert.equal(readLockRef(unrelated), '');
  assert.equal(lock.release(), true);
});

test('Git ownership failure is returned fail-closed without a trust-override retry', () => {
  const calls = [];
  const result = resolveGitCommonDir('C:\\fixture', {
    execFileSyncImpl: (command, args) => {
      calls.push([command, args]);
      const error = new Error('fatal: detected dubious ownership');
      error.status = 128;
      throw error;
    },
  });
  assert.equal(result, '');
  assert.deepEqual(calls, [[
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  ]]);
});

test('AGENTS_BOARD_DIR cannot prune unless status is an explicit read-only snapshot', (t) => {
  const fixtureRoot = withTempDir(t, 'queue-board-override-');
  const boardDir = path.join(fixtureRoot, 'board');
  const sessions = path.join(boardDir, 'sessions');
  const recordPath = path.join(sessions, 'fixture.json');
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(recordPath, `${JSON.stringify({
    agent: 'fixture',
    session: 'old',
    status: 'ended',
    updatedAt: '2000-01-01T00:00:00.000Z',
  })}\n`, 'utf8');
  const env = { ...process.env, AGENTS_BOARD_DIR: boardDir };
  let failure;
  try {
    execFileSync(process.execPath, [BOARD_SCRIPT, 'status'], {
      cwd: SCRIPT_DIR,
      env,
      stdio: 'pipe',
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.status, 2);
  assert.equal(fs.existsSync(recordPath), true);
  failure = undefined;
  try {
    execFileSync(
      process.execPath,
      [BOARD_SCRIPT, 'status', '--json', 'true', '--no-prune', 'true'],
      { cwd: SCRIPT_DIR, env, stdio: 'pipe' },
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.status, 2);
  assert.equal(fs.existsSync(recordPath), true);
  const snapshot = JSON.parse(execFileSync(
    process.execPath,
    [BOARD_SCRIPT, 'status', '--json', '--no-prune'],
    { cwd: SCRIPT_DIR, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ));
  assert.equal(path.resolve(snapshot.boardDir), path.resolve(boardDir));
  assert.equal(snapshot.sessions.length, 1);
  assert.equal(fs.existsSync(recordPath), true);

  const deniedEntrypoints = [
    {
      args: ['register', '--agent', 'fixture', '--session', 'no-write'],
    },
    {
      args: ['hook', '--event', 'SessionStart'],
      input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: fixtureRoot }),
    },
    {
      args: ['codex-notify', JSON.stringify({
        type: 'agent-turn-complete',
        cwd: fixtureRoot,
        'thread-id': 'no-write',
      })],
    },
  ];
  for (const attempt of deniedEntrypoints) {
    failure = undefined;
    try {
      execFileSync(process.execPath, [BOARD_SCRIPT, ...attempt.args], {
        cwd: fixtureRoot,
        env,
        input: attempt.input,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.status, 2, attempt.args[0]);
  }
  assert.equal(fs.existsSync(recordPath), true);
  assert.equal(fs.existsSync(path.join(sessions, 'fixture--no-write.json')), false);
});

test('queue lock Git plumbing is exact and rejects hook or trust overrides', () => {
  assert.equal(isAllowedPrQueueLockGitCommand([
    'rev-parse', '--verify', '--quiet', PR_QUEUE_LOCK_REF,
  ]), true);
  assert.equal(isAllowedPrQueueLockGitCommand([
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]), true);
  assert.equal(isAllowedPrQueueLockGitCommand([
    'config', '--path', '--get', 'core.hooksPath',
  ]), true);
  for (const args of [
    ['-c', 'safe.directory=C:/fixture', 'rev-parse', '--verify', '--quiet', PR_QUEUE_LOCK_REF],
    ['-c', 'core.hooksPath=NUL', 'update-ref', PR_QUEUE_LOCK_REF, 'a'.repeat(40)],
    ['config', '--global', '--path', '--get', 'core.hooksPath'],
    ['commit', '-m', 'bypass'],
    ['update-ref', PR_QUEUE_LOCK_REF, 'a'.repeat(40), '0'.repeat(40)],
  ]) {
    assert.equal(isAllowedPrQueueLockGitCommand(args), false, args.join(' '));
  }
});

test('queue lock refuses to invoke a reference-transaction hook', (t) => {
  const repo = initGitRepo(t, 'queue-reference-hook-');
  const marker = path.join(path.dirname(repo), 'reference-hook-ran.txt');
  const hook = path.join(repo, '.git', 'hooks', 'reference-transaction');
  const markerForShell = marker.replace(/\\/g, '/').replace(/'/g, "'\\''");
  fs.writeFileSync(hook, `#!/bin/sh\nprintf invoked > '${markerForShell}'\n`, 'utf8');
  fs.chmodSync(hook, 0o755);
  const lock = acquirePrQueueLock({
    repoRoot: repo,
    getProcessCreationIdentityImpl: (pid) => `fixture-process:${pid}`,
  });
  if (lock) lock.release();
  assert.equal(lock, null);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(readLockRef(repo), '');
});

test('canonical checkout and linked worktree resolve one shared board', (t) => {
  const container = withTempDir(t, 'queue-board-');
  const repo = path.join(container, 'repo');
  const linked = path.join(container, 'linked');
  fs.mkdirSync(repo);
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['worktree', 'add', '-b', 'fixture-linked', linked], { cwd: repo, stdio: 'ignore' });
  assert.equal(resolveSharedBoardDir(linked), resolveSharedBoardDir(repo));
  const commonDir = path.join(repo, '.git');
  assert.equal(resolveSharedBoardDir(repo, {
    env: { AGENTS_BOARD_DIR: path.join(repo, 'alternate-board') },
    execFileSyncImpl: () => commonDir,
  }), path.join(repo, '.agents', 'board'));
});

test('release retries transient ref-file contention only for its current generation', () => {
  const objectId = 'a'.repeat(40);
  let deleteAttempts = 0;
  let currentGenerationReads = 0;
  const execFileSyncImpl = (_command, args) => {
    if (args[0] === 'hash-object') return `${objectId}\n`;
    if (args[0] === 'update-ref' && args[2] !== '-d') return '';
    if (args[0] === 'update-ref' && args[2] === '-d') {
      deleteAttempts += 1;
      if (deleteAttempts === 1) {
        const error = new Error('transient ref-file contention');
        error.status = 1;
        throw error;
      }
      return '';
    }
    if (args[0] === 'rev-parse') {
      currentGenerationReads += 1;
      return `${objectId}\n`;
    }
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };
  const lock = acquirePrQueueLock({
    repoRoot: 'C:\\fixture',
    getProcessCreationIdentityImpl: (pid) => `fixture-process:${pid}`,
    execFileSyncImpl,
    isReferenceTransactionHookSafeImpl: () => true,
  });
  assert.ok(lock);
  assert.equal(lock.release(), true);
  assert.equal(deleteAttempts, 2);
  assert.equal(currentGenerationReads, 1);
});

test('release does not retry after the exact ref advances to a successor', () => {
  const objectId = 'a'.repeat(40);
  const successorId = 'b'.repeat(40);
  let deleteAttempts = 0;
  let currentGenerationReads = 0;
  const execFileSyncImpl = (_command, args) => {
    if (args[0] === 'hash-object') return `${objectId}\n`;
    if (args[0] === 'update-ref' && args[2] !== '-d') return '';
    if (args[0] === 'update-ref' && args[2] === '-d') {
      deleteAttempts += 1;
      const error = new Error('generation changed');
      error.status = 1;
      throw error;
    }
    if (args[0] === 'rev-parse') {
      currentGenerationReads += 1;
      return `${successorId}\n`;
    }
    throw new Error(`unexpected git args: ${args.join(' ')}`);
  };
  const lock = acquirePrQueueLock({
    repoRoot: 'C:\\fixture',
    getProcessCreationIdentityImpl: (pid) => `fixture-process:${pid}`,
    execFileSyncImpl,
    isReferenceTransactionHookSafeImpl: () => true,
  });
  assert.ok(lock);
  assert.equal(lock.release(), false);
  assert.equal(deleteAttempts, 1);
  assert.equal(currentGenerationReads, 1);
});

test('owner-token release cannot delete a successor generation', (t) => {
  const repo = initGitRepo(t, 'queue-successor-');
  const identityForPid = (pid) => `fixture-process:${pid}`;
  const first = acquirePrQueueLock({
    repoRoot: repo,
    getProcessCreationIdentityImpl: identityForPid,
  });
  assert.ok(first);
  git(repo, ['update-ref', '-d', PR_QUEUE_LOCK_REF, first.objectId]);
  const successor = {
    schema_version: PR_QUEUE_LOCK_SCHEMA,
    pid: process.pid,
    owner_token: randomUUID(),
    creation_identity: identityForPid(process.pid),
    created_at: new Date().toISOString(),
  };
  const successorId = writeLockRef(repo, successor);
  assert.equal(first.release(), false);
  assert.equal(readLockRef(repo), successorId);
});

test('stale cleanup uses compare-and-swap and cannot delete a racing successor', (t) => {
  const repo = initGitRepo(t, 'queue-reclaim-race-');
  const stale = {
    schema_version: PR_QUEUE_LOCK_SCHEMA,
    pid: 31337,
    owner_token: randomUUID(),
    creation_identity: 'dead-generation',
    created_at: '2000-01-01T00:00:00.000Z',
  };
  const staleId = writeLockRef(repo, stale);
  const successor = {
    schema_version: PR_QUEUE_LOCK_SCHEMA,
    pid: process.pid,
    owner_token: randomUUID(),
    creation_identity: `fixture-process:${process.pid}`,
    created_at: new Date().toISOString(),
  };
  let successorId = '';
  let injected = false;
  const racingExec = (command, args, options) => {
    const updateIndex = args.indexOf('update-ref');
    const deleteIndex = args.indexOf('-d');
    if (!injected && command === 'git' && updateIndex >= 0 && deleteIndex > updateIndex) {
      injected = true;
      git(repo, ['update-ref', '-d', PR_QUEUE_LOCK_REF, staleId]);
      successorId = writeLockRef(repo, successor);
    }
    return execFileSync(command, args, options);
  };
  const result = cleanupStalePrQueueLock(repo, {
    isPidAliveImpl: () => false,
    execFileSyncImpl: racingExec,
  });
  assert.equal(result.cleaned, false);
  assert.equal(result.reason, 'reclaim_race');
  assert.equal(readLockRef(repo), successorId);
});

test('PID reuse is reclaimable without applying a TTL to a live owner', (t) => {
  const repo = initGitRepo(t, 'queue-pid-reuse-');
  writeLockRef(repo, {
    schema_version: PR_QUEUE_LOCK_SCHEMA,
    pid: 31337,
    owner_token: randomUUID(),
    creation_identity: 'old-generation',
    created_at: '2000-01-01T00:00:00.000Z',
  });
  const result = cleanupStalePrQueueLock(repo, {
    isPidAliveImpl: () => true,
    getProcessCreationIdentityImpl: () => 'new-generation',
  });
  assert.deepEqual({ cleaned: result.cleaned, reason: result.reason }, {
    cleaned: true,
    reason: 'pid_reused',
  });
  assert.equal(readLockRef(repo), '');
});

test('20 workers serialize through the real atomic queue lock', { timeout: 90_000 }, async (t) => {
  const root = withTempDir(t, 'queue-stress-');
  const repo = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  const resultsFile = path.join(root, 'results.txt');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });

  const workers = Array.from({ length: 20 }, (_, index) => new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, repo, stateDir, resultsFile], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ index, code, stdout, stderr }));
  }));
  const outcomes = await Promise.all(workers);
  assert.deepEqual(
    outcomes.filter((outcome) => outcome.code !== 0),
    [],
    JSON.stringify(outcomes.filter((outcome) => outcome.code !== 0)),
  );
  const records = fs.readFileSync(resultsFile, 'utf8').trim().split(/\r?\n/);
  assert.equal(records.length, 20);
  assert.equal(new Set(records).size, 20);
  assert.equal(fs.existsSync(path.join(stateDir, 'critical-section.guard')), false);
  assert.equal(readLockRef(repo), '');
});
