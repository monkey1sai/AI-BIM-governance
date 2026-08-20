import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertStatsShape,
  recordStatsBefore,
  statsHealth,
} from '../dev/kit-message-probe/stats-health.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('healthy statsBefore.pcs is a non-empty array', () => {
  const health = statsHealth({ at: 1, pcs: [{ conn: 'connected', rows: [] }] });
  assert.deepEqual(health, { ok: true, pcsCount: 1 });
  assert.doesNotThrow(() => assertStatsShape({ pcs: [{}] }));
});

test('empty-object statsBefore fails closed and names awaitPromise/replMode', () => {
  const health = statsHealth({});
  assert.equal(health.ok, false);
  assert.match(health.reason, /awaitPromise/);
  assert.match(health.reason, /replMode/);
  assert.throws(() => assertStatsShape({}), /awaitPromise/);
  assert.throws(() => assertStatsShape({ pcs: [] }), /replMode/);
  assert.throws(() => assertStatsShape(null), /awaitPromise/);
});

test('recordStatsBefore writes statsHealth then throws so the run exits non-zero', () => {
  const result = {};
  assert.throws(() => recordStatsBefore(result, {}), (error) => {
    assert.match(error.message, /awaitPromise/);
    assert.match(error.message, /replMode/);
    return true;
  });
  assert.equal(result.statsHealth.ok, false);
  assert.deepEqual(result.statsBefore, {});
});

test('kit-message-probe driver is registered in script-registry.json', () => {
  const registry = JSON.parse(
    readFileSync(path.join(repoRoot, 'scripts', 'script-registry.json'), 'utf8'),
  );
  const entries = registry.scripts.filter(
    (entry) => entry.path === 'scripts/dev/kit-message-probe/driver.mjs',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'diagnostic');
  assert.equal(entries[0].owner, 'scripts');
});
