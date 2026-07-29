import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertSafeVerificationCommand } from '../lib/verification-command-policy.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'verification-manifest.json'), 'utf8'));

test('every configured manifest gate satisfies the closed argv policy', () => {
  for (const gate of manifest.gates.filter(({ configured }) => configured)) {
    assert.doesNotThrow(() => assertSafeVerificationCommand(gate.command), gate.id);
  }
});

test('inline interpreters, downloader-capable npx, and arbitrary npm/python entrypoints are rejected', () => {
  for (const command of [
    { executable: 'pwsh', args: ['-NoProfile', '-Command', 'Write-Host compromised'] },
    { executable: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', '../outside.ps1'] },
    { executable: 'npx', args: ['playwright', 'test', '--config=playwright.config.ts'] },
    { executable: 'npm', args: ['exec', '--', 'node', '-e', 'process.exit()'] },
    { executable: 'python', args: ['-c', 'print(1)'] },
    { executable: 'node', args: ['-e', 'process.exit()'] },
  ]) assert.throws(() => assertSafeVerificationCommand(command));
});
