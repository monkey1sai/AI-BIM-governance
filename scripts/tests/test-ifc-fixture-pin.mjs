// node --test suite for the IFC fixture pinning logic (plan B7).
// Pure-logic only: no SDK, no network — CI-runnable without coordinator deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANIFEST_SCHEMA,
  SIDECAR_SCHEMA,
  loadManifest,
  validateManifest,
  comparePin,
  evaluateCacheSidecar,
  buildSidecar,
} from '../lib/ifc-fixture-pin.mjs';

const entry = {
  logical_name: 'demo_lib_2026.ifc',
  bucket: 'bim-control',
  key: 'fixtures/demo_lib_2026.ifc',
  etag: 'abc123-6',
  size_bytes: 89394282,
  version_id: null,
};
const manifest = { schema_version: MANIFEST_SCHEMA, entries: [entry] };

test('valid manifest passes and returns itself', () => {
  assert.equal(validateManifest(manifest), manifest);
});

test('real repo manifest loads (mechanism ships before pins exist)', () => {
  const real = loadManifest(fileURLToPath(new URL('../ifc-fixture-manifest.json', import.meta.url)));
  assert.equal(real.schema_version, MANIFEST_SCHEMA);
  assert.ok(Array.isArray(real.entries));
});

test('schema version fails closed', () => {
  assert.throws(() => validateManifest({ schema_version: 'nope/v9', entries: [] }), /unsupported schema_version/);
});

test('duplicate logical names fail closed', () => {
  assert.throws(
    () => validateManifest({ schema_version: MANIFEST_SCHEMA, entries: [entry, { ...entry }] }),
    /duplicate logical_name/,
  );
});

test('path-like logical names are rejected', () => {
  assert.throws(
    () => validateManifest({ schema_version: MANIFEST_SCHEMA, entries: [{ ...entry, logical_name: 'a/b.ifc' }] }),
    /bare file name/,
  );
});

test('missing etag / bad size fail closed', () => {
  assert.throws(() => validateManifest({ schema_version: MANIFEST_SCHEMA, entries: [{ ...entry, etag: '' }] }), /etag/);
  assert.throws(() => validateManifest({ schema_version: MANIFEST_SCHEMA, entries: [{ ...entry, size_bytes: 0 }] }), /size_bytes/);
});

test('malformed manifest file fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ifc-pin-'));
  try {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{nope');
    assert.throws(() => loadManifest(bad), /not valid JSON/);
    assert.throws(() => loadManifest(join(dir, 'missing.json')), /not readable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('comparePin: exact match, quote-insensitive etag', () => {
  assert.equal(comparePin(entry, { etag: '"abc123-6"', size_bytes: 89394282, version_id: null }).verdict, 'match');
});

test('comparePin: etag drift fails closed with a named reason', () => {
  const result = comparePin(entry, { etag: 'zzz', size_bytes: 89394282 });
  assert.equal(result.verdict, 'mismatch');
  assert.match(result.reasons.join(' '), /etag_mismatch/);
});

test('comparePin: size drift fails closed', () => {
  const result = comparePin(entry, { etag: 'abc123-6', size_bytes: 1 });
  assert.equal(result.verdict, 'mismatch');
  assert.match(result.reasons.join(' '), /size_mismatch/);
});

test('comparePin: pinned version must match; null pin ignores version', () => {
  const pinned = { ...entry, version_id: 'v1' };
  assert.equal(comparePin(pinned, { etag: 'abc123-6', size_bytes: 89394282, version_id: 'v2' }).verdict, 'mismatch');
  assert.equal(comparePin(pinned, { etag: 'abc123-6', size_bytes: 89394282, version_id: 'v1' }).verdict, 'match');
  assert.equal(comparePin(entry, { etag: 'abc123-6', size_bytes: 89394282, version_id: 'whatever' }).verdict, 'match');
});

test('comparePin: missing observation is a mismatch, never a pass', () => {
  assert.equal(comparePin(entry, null).verdict, 'mismatch');
});

test('cache without sidecar is unverifiable, not valid', () => {
  assert.equal(evaluateCacheSidecar(entry, null).verdict, 'unverifiable_no_sidecar');
});

test('sidecar with drifted pin marks the cache stale', () => {
  const sidecar = buildSidecar(entry, 'a'.repeat(64));
  assert.equal(evaluateCacheSidecar(entry, sidecar, 'a'.repeat(64)).verdict, 'cache_valid');
  const drifted = { ...sidecar, etag: 'other' };
  assert.equal(evaluateCacheSidecar(entry, drifted, 'a'.repeat(64)).verdict, 'stale_cache');
});

test('cache bytes must still match the downloaded sidecar hash', () => {
  const sidecar = buildSidecar(entry, 'a'.repeat(64));
  const changed = evaluateCacheSidecar(entry, sidecar, 'b'.repeat(64));
  assert.equal(changed.verdict, 'stale_cache');
  assert.match(changed.reasons.join(' '), /sha256_mismatch/);
  assert.equal(evaluateCacheSidecar(entry, { ...sidecar, sha256: 'bad' }, 'a'.repeat(64)).verdict, 'stale_cache');
});

test('sidecar requires a real sha256', () => {
  assert.throws(() => buildSidecar(entry, 'short'), /sha256/);
  assert.equal(buildSidecar(entry, 'f'.repeat(64)).schema_version, SIDECAR_SCHEMA);
});
