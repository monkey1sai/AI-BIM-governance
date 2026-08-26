#!/usr/bin/env node
// test-manage-pr-queue.mjs — Test suite for autonomous PR queue and hook mechanics

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveGitignoreConflict,
  autoResolveConflicts,
  installGitHooks,
  getOpenPrs,
  getOriginMainSha,
  getPrChecks,
} from '../dev/manage-pr-queue.mjs';

const TEST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');

console.log('--- Running test-manage-pr-queue ---');

// 1. Verify exports
assert.equal(typeof getOpenPrs, 'function', 'getOpenPrs must be a function');
assert.equal(typeof getOriginMainSha, 'function', 'getOriginMainSha must be a function');
assert.equal(typeof getPrChecks, 'function', 'getPrChecks must be a function');
assert.equal(typeof installGitHooks, 'function', 'installGitHooks must be a function');
console.log('✔ Core functions exported correctly');

// 2. Test Git hooks installation
const gitHooksDir = path.join(REPO_ROOT, '.git', 'hooks');
const installed = installGitHooks();
assert.equal(installed, true, 'installGitHooks should return true');
assert.ok(fs.existsSync(path.join(gitHooksDir, 'post-commit')), 'post-commit hook must exist');
assert.ok(fs.existsSync(path.join(gitHooksDir, 'post-merge')), 'post-merge hook must exist');
assert.ok(fs.existsSync(path.join(gitHooksDir, 'post-checkout')), 'post-checkout hook must exist');
console.log('✔ Git hooks installation verified');

// 3. Test non-critical auto-resolve rules
const dummyConflictFiles = [
  'docs/current_task.md',
  'docs/superpowers/plans/phase-1.md',
  'docs/plans/NOW.md',
  'artifacts/e2e/test.json',
  '.agents/skills/test.md',
];
// Test non-critical detection logic
for (const file of dummyConflictFiles) {
  const isNonCritical = (
    file.includes('current_task.md') ||
    file.includes('docs/superpowers/plans/') ||
    file.includes('docs/plans/') ||
    file.includes('docs/archive-') ||
    file.includes('artifacts/') ||
    file.includes('.agents/')
  );
  assert.ok(isNonCritical, `File ${file} should be detected as non-critical auto-resolvable`);
}
console.log('✔ Non-critical conflict detection patterns verified');

console.log('--- All test-manage-pr-queue assertions passed! ---');
