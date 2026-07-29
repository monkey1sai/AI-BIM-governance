import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateSecurityExceptions } from '../lib/security-exceptions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-manifest.json'), 'utf8'));

function entry() {
  return { id: 'accepted-risk', gate_id: 'sast', rule_id: 'rule-one', finding_fingerprint: 'a'.repeat(64),
    exact_scope: 'web-viewer-sample/src/example.ts', owner: 'security-owner', reason: 'Tracked false positive.',
    created_on: '2026-07-01', expires_on: '2026-08-01' };
}

test('empty and bounded security exception ledgers pass deterministically', () => {
  const canonical = JSON.parse(readFileSync(path.join(root, 'scripts', 'security-exceptions.json'), 'utf8'));
  assert.equal(validateSecurityExceptions(canonical, manifest, new Date('2026-07-28T00:00:00Z')).result, 'valid');
  assert.equal(validateSecurityExceptions({ schema_version: 'security-exceptions/v1', exceptions: [] }, manifest,
    new Date('2026-07-28T00:00:00Z')).result, 'valid');
  assert.equal(validateSecurityExceptions({ schema_version: 'security-exceptions/v1', exceptions: [entry()] }, manifest,
    new Date('2026-07-28T00:00:00Z')).exception_count, 1);
});

test('expired, wildcard, duplicate, unknown-gate, and secret-bearing fields fail closed', () => {
  for (const mutate of [
    (item) => { item.expires_on = '2026-07-20'; },
    (item) => { item.exact_scope = '**'; },
    (item) => { item.gate_id = 'unknown-gate'; },
    (item) => { item.secret_value = 'must-not-be-stored'; },
    (item) => { item.created_on = '2026-07-29'; item.expires_on = '2026-08-01'; },
    (item) => { item.owner = '   '; },
    (item) => { item.reason = 'github_pat_' + 'a'.repeat(50); },
    (item) => { item.owner = 'ghp_' + 'a'.repeat(30); },
    (item) => { item.exact_scope = `safe\npath`; },
    (item) => { item.exact_scope = 'a'.repeat(301); },
    (item) => { item.exact_scope = 'github_pat_' + 'a'.repeat(50); },
  ]) {
    const item = entry(); mutate(item);
    assert.throws(() => validateSecurityExceptions({ schema_version: 'security-exceptions/v1', exceptions: [item] }, manifest,
      new Date('2026-07-28T00:00:00Z')));
  }
  assert.throws(() => validateSecurityExceptions({ schema_version: 'security-exceptions/v1', exceptions: [entry(), entry()] }, manifest,
    new Date('2026-07-28T00:00:00Z')));
});
