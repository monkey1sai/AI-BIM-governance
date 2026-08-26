import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupStaleLocks, pruneGitWorktrees, cleanupOrphanDevProcesses } from '../dev/cleanup-orphan-dev-processes.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

console.log('--- Running test-cleanup-orphan-dev-processes ---');

// 1. Test stale lock cleanup
const testBoard = path.join(REPO_ROOT, '.agents', 'board-test-clean');
if (!fs.existsSync(testBoard)) fs.mkdirSync(testBoard, { recursive: true });
const testLock = path.join(testBoard, 'pr-queue.lock');

// Create a lock with an impossible dead PID (999999)
fs.writeFileSync(testLock, JSON.stringify({ pid: 999999, timestamp: Date.now() - 10000 }), 'utf8');
assert.equal(fs.existsSync(testLock), true, 'Test lock should exist initially');

const cleaned = cleanupStaleLocks(testBoard);
assert.equal(cleaned, 1, 'Should clean 1 stale lock with dead PID');
assert.equal(fs.existsSync(testLock), false, 'Lock file should have been removed');
console.log('✔ Stale lock cleanup with dead PID verified');

// 2. Test prune git worktrees function
const pruneResult = pruneGitWorktrees(REPO_ROOT);
assert.equal(pruneResult, true, 'pruneGitWorktrees should succeed');
console.log('✔ Git worktree prune verified');

// 3. Test cleanupOrphanDevProcesses return structure
const res = cleanupOrphanDevProcesses(true);
assert.ok(Array.isArray(res.killed), 'res.killed should be an array');
assert.equal(typeof res.prunedWorktrees, 'boolean', 'res.prunedWorktrees should be boolean');
assert.equal(typeof res.staleLocksCleaned, 'number', 'res.staleLocksCleaned should be number');
console.log('✔ cleanupOrphanDevProcesses execution and schema verified');

// Clean up test dir
try { fs.rmSync(testBoard, { recursive: true, force: true }); } catch {}

console.log('--- All test-cleanup-orphan-dev-processes assertions passed! ---');
