import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  buildGitArgs,
  buildIsolatedGitEnv,
} from './agents-board-path.mjs';

export const PR_QUEUE_LOCK_SCHEMA = 'pr-queue-lock/v3';
export const PR_QUEUE_LOCK_REF = 'refs/ai-bim/pr-queue-lock';

const ZERO_OID = '0'.repeat(40);
const REF_DELETE_RETRY_DELAYS_MS = Object.freeze([2, 4, 8, 16, 32, 64]);
const REF_DELETE_RETRY_STATE = new Int32Array(new SharedArrayBuffer(4));

function waitForRefDeleteRetry(delayMs) {
  Atomics.wait(REF_DELETE_RETRY_STATE, 0, 0, delayMs);
}

export function isPidAlive(pid, processKill = process.kill.bind(process)) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    processKill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function getProcessCreationIdentity(
  pid,
  {
    platform = process.platform,
    execFileSyncImpl = execFileSync,
    fsImpl = fs,
  } = {},
) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return '';
  try {
    if (platform === 'win32') {
      const script = [
        '$targetPid = [int]$env:AI_BIM_PR_QUEUE_PID',
        "$record = Get-CimInstance Win32_Process -Filter ('ProcessId={0}' -f $targetPid) -ErrorAction SilentlyContinue",
        "if ($null -ne $record -and $null -ne $record.CreationDate) { $record.CreationDate.ToUniversalTime().ToString('o') }",
      ].join('; ');
      return execFileSyncImpl(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            AI_BIM_PR_QUEUE_PID: String(pid),
          },
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: true,
        },
      ).trim();
    }
    if (platform === 'linux') {
      const stat = fsImpl.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const tail = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
      const startTime = tail[19];
      const bootId = fsImpl.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
      return startTime && bootId ? `linux:${bootId}:${startTime}` : '';
    }
  } catch {
    return '';
  }
  return '';
}

export function isAllowedPrQueueLockGitCommand(args) {
  if (!Array.isArray(args)) return false;
  const oid = (value) => /^[0-9a-f]{40}$/i.test(String(value || ''));
  if (
    args.length === 4
    && args[0] === 'rev-parse'
    && args[1] === '--verify'
    && args[2] === '--quiet'
    && args[3] === PR_QUEUE_LOCK_REF
  ) return true;
  if (
    args.length === 3
    && args[0] === 'rev-parse'
    && args[1] === '--path-format=absolute'
    && args[2] === '--git-common-dir'
  ) return true;
  if (
    args.length === 4
    && args[0] === 'config'
    && args[1] === '--path'
    && args[2] === '--get'
    && args[3] === 'core.hooksPath'
  ) return true;
  if (args.length === 3 && args[0] === 'cat-file' && args[1] === 'blob' && oid(args[2])) {
    return true;
  }
  if (args.length === 3 && args[0] === 'hash-object' && args[1] === '-w' && args[2] === '--stdin') {
    return true;
  }
  if (
    args.length === 5
    && args[0] === 'update-ref'
    && args[1] === '--no-deref'
    && args[2] === PR_QUEUE_LOCK_REF
    && oid(args[3])
    && args[4] === ZERO_OID
  ) return true;
  return (
    args.length === 5
    && args[0] === 'update-ref'
    && args[1] === '--no-deref'
    && args[2] === '-d'
    && args[3] === PR_QUEUE_LOCK_REF
    && oid(args[4])
  );
}

function runGit(
  repoRoot,
  args,
  {
    input,
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  if (!isAllowedPrQueueLockGitCommand(args)) {
    return { ok: false, stdout: '' };
  }
  try {
    const stdout = execFileSyncImpl('git', buildGitArgs(args), {
      cwd: repoRoot,
      encoding: 'utf8',
      env: buildIsolatedGitEnv(env),
      input,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.trim(), exitCode: 0 };
  } catch (error) {
    return { ok: false, stdout: '', exitCode: Number(error?.status ?? 1) };
  }
}

export function isReferenceTransactionHookSafe(
  repoRoot,
  {
    execFileSyncImpl = execFileSync,
    env = process.env,
    fsImpl = fs,
  } = {},
) {
  const configuredHooksPath = runGit(
    repoRoot,
    ['config', '--path', '--get', 'core.hooksPath'],
    { execFileSyncImpl, env },
  );
  if (configuredHooksPath.ok || configuredHooksPath.exitCode !== 1) return false;

  const commonDir = runGit(
    repoRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { execFileSyncImpl, env },
  );
  if (!commonDir.ok || !path.isAbsolute(commonDir.stdout)) return false;
  try {
    fsImpl.lstatSync(path.join(commonDir.stdout, 'hooks', 'reference-transaction'));
    return false;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

function referenceTransactionHookIsSafe(repoRoot, options = {}) {
  const check = options.isReferenceTransactionHookSafeImpl
    || isReferenceTransactionHookSafe;
  return check(repoRoot, options);
}

function readGitRefLock(repoRoot, options = {}) {
  const oidResult = runGit(repoRoot, ['rev-parse', '--verify', '--quiet', PR_QUEUE_LOCK_REF], options);
  if (!oidResult.ok || !/^[0-9a-f]{40}$/i.test(oidResult.stdout)) {
    return { objectId: '', record: null, reason: 'missing' };
  }
  const objectId = oidResult.stdout.toLowerCase();
  const blob = runGit(repoRoot, ['cat-file', 'blob', objectId], options);
  if (!blob.ok) return { objectId, record: null, reason: 'invalid_fail_closed' };
  try {
    return { objectId, record: JSON.parse(blob.stdout), reason: 'present' };
  } catch {
    return { objectId, record: null, reason: 'invalid_fail_closed' };
  }
}

function writeLockBlob(repoRoot, record, options = {}) {
  const result = runGit(repoRoot, ['hash-object', '-w', '--stdin'], {
    ...options,
    input: `${JSON.stringify(record)}\n`,
  });
  return result.ok && /^[0-9a-f]{40}$/i.test(result.stdout) ? result.stdout.toLowerCase() : '';
}

function createExactGitRef(repoRoot, objectId, options = {}) {
  if (!referenceTransactionHookIsSafe(repoRoot, options)) return false;
  return runGit(
    repoRoot,
    ['update-ref', '--no-deref', PR_QUEUE_LOCK_REF, objectId, ZERO_OID],
    options,
  ).ok;
}

function deleteExactGitRef(repoRoot, objectId, options = {}) {
  if (!/^[0-9a-f]{40}$/i.test(String(objectId || ''))) return false;
  const expectedObjectId = objectId.toLowerCase();
  for (let attempt = 0; attempt <= REF_DELETE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (!referenceTransactionHookIsSafe(repoRoot, options)) return false;
    if (runGit(
      repoRoot,
      ['update-ref', '--no-deref', '-d', PR_QUEUE_LOCK_REF, expectedObjectId],
      options,
    ).ok) return true;
    if (attempt === REF_DELETE_RETRY_DELAYS_MS.length) return false;

    const current = runGit(
      repoRoot,
      ['rev-parse', '--verify', '--quiet', PR_QUEUE_LOCK_REF],
      options,
    );
    if (!current.ok || current.stdout.toLowerCase() !== expectedObjectId) return false;
    waitForRefDeleteRetry(REF_DELETE_RETRY_DELAYS_MS[attempt]);
  }
  return false;
}

export function isValidPrQueueLock(record) {
  return Boolean(
    record
      && record.schema_version === PR_QUEUE_LOCK_SCHEMA
      && Number.isSafeInteger(record.pid)
      && record.pid > 0
      && typeof record.owner_token === 'string'
      && /^[0-9a-f-]{36}$/i.test(record.owner_token)
      && typeof record.creation_identity === 'string'
      && record.creation_identity.length > 0
      && typeof record.created_at === 'string'
      && !Number.isNaN(Date.parse(record.created_at)),
  );
}

export function classifyPrQueueLock(
  record,
  {
    isPidAliveImpl = isPidAlive,
    getProcessCreationIdentityImpl = getProcessCreationIdentity,
  } = {},
) {
  if (!isValidPrQueueLock(record)) return 'invalid_fail_closed';
  if (!isPidAliveImpl(record.pid)) return 'dead_owner';
  const currentIdentity = getProcessCreationIdentityImpl(record.pid);
  if (!currentIdentity) return 'identity_unknown_fail_closed';
  if (currentIdentity !== record.creation_identity) return 'pid_reused';
  return 'active_owner';
}

export function cleanupStalePrQueueLock(
  repoRoot,
  {
    isPidAliveImpl = isPidAlive,
    getProcessCreationIdentityImpl = getProcessCreationIdentity,
    execFileSyncImpl = execFileSync,
    env = process.env,
    fsImpl = fs,
    isReferenceTransactionHookSafeImpl = isReferenceTransactionHookSafe,
  } = {},
) {
  if (!repoRoot) return { cleaned: false, reason: 'repo_root_missing', lockRef: PR_QUEUE_LOCK_REF };
  const lockOptions = {
    execFileSyncImpl,
    env,
    fsImpl,
    isReferenceTransactionHookSafeImpl,
  };
  if (!referenceTransactionHookIsSafe(repoRoot, lockOptions)) {
    return {
      cleaned: false,
      reason: 'reference_transaction_hook_unsafe',
      lockRef: PR_QUEUE_LOCK_REF,
    };
  }
  const snapshot = readGitRefLock(repoRoot, lockOptions);
  if (!snapshot.objectId) {
    return { cleaned: false, reason: snapshot.reason, lockRef: PR_QUEUE_LOCK_REF };
  }
  const reason = classifyPrQueueLock(snapshot.record, {
    isPidAliveImpl,
    getProcessCreationIdentityImpl,
  });
  if (!['dead_owner', 'pid_reused'].includes(reason)) {
    return {
      cleaned: false,
      reason,
      lockRef: PR_QUEUE_LOCK_REF,
      objectId: snapshot.objectId,
    };
  }
  const cleaned = deleteExactGitRef(repoRoot, snapshot.objectId, lockOptions);
  return {
    cleaned,
    reason: cleaned ? reason : 'reclaim_race',
    lockRef: PR_QUEUE_LOCK_REF,
    objectId: snapshot.objectId,
  };
}

export function acquirePrQueueLock(
  {
    repoRoot,
    pid = process.pid,
    now = () => new Date(),
    tokenFactory = randomUUID,
    isPidAliveImpl = isPidAlive,
    getProcessCreationIdentityImpl = getProcessCreationIdentity,
    execFileSyncImpl = execFileSync,
    env = process.env,
    fsImpl = fs,
    isReferenceTransactionHookSafeImpl = isReferenceTransactionHookSafe,
  } = {},
) {
  if (!repoRoot) return null;
  const lockOptions = {
    execFileSyncImpl,
    env,
    fsImpl,
    isReferenceTransactionHookSafeImpl,
  };
  if (!referenceTransactionHookIsSafe(repoRoot, lockOptions)) return null;
  const creationIdentity = getProcessCreationIdentityImpl(pid);
  if (!creationIdentity) return null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ownerToken = tokenFactory();
    const record = {
      schema_version: PR_QUEUE_LOCK_SCHEMA,
      pid,
      owner_token: ownerToken,
      creation_identity: creationIdentity,
      created_at: now().toISOString(),
    };
    const objectId = writeLockBlob(repoRoot, record, lockOptions);
    if (!objectId) return null;
    if (createExactGitRef(repoRoot, objectId, lockOptions)) {
      let released = false;
      return {
        lockRef: PR_QUEUE_LOCK_REF,
        objectId,
        ownerToken,
        record,
        release() {
          if (released) return false;
          released = deleteExactGitRef(repoRoot, objectId, lockOptions);
          return released;
        },
      };
    }
    const reclaimed = cleanupStalePrQueueLock(repoRoot, {
      isPidAliveImpl,
      getProcessCreationIdentityImpl,
      execFileSyncImpl,
      env,
      fsImpl,
      isReferenceTransactionHookSafeImpl,
    });
    if (!reclaimed.cleaned) return null;
  }
  return null;
}
