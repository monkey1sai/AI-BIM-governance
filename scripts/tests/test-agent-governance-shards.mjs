import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  AGENT_GOVERNANCE_SHARDS_VERSION,
  AgentGovernanceShardsError,
  selectShards,
  validateShardPolicy,
} from '../lib/agent-governance-shards.mjs';

const canonical = JSON.parse(readFileSync(new URL('../agent-governance-shards.json', import.meta.url), 'utf8'));

function policy(overrides = {}) {
  return {
    $schema: './tests/agent-governance-shards.schema.json',
    schema_version: AGENT_GOVERNANCE_SHARDS_VERSION,
    authority: 'shard_selection_only',
    purpose: 'p',
    not_a_gate: 'n',
    shards: [
      { id: 'core', always: true, title: 'c', reason: 'r', path_globs: [] },
      { id: 'openspec', always: false, title: 'o', reason: 'r', path_globs: ['openspec/**'] },
      { id: 'capability', always: false, title: 'k', reason: 'r', path_globs: ['scripts/lib/detect-base-gate-capability.sh'] },
    ],
    ...overrides,
  };
}

test('the canonical declaration in the repository is valid', () => {
  assert.equal(validateShardPolicy(canonical), canonical);
  const ids = canonical.shards.map((shard) => shard.id);
  assert.deepEqual([...ids].sort(), ['capability', 'core', 'evidence', 'openspec']);
  assert.equal(canonical.shards.filter((shard) => shard.always).length, 1);
  assert.equal(canonical.shards.find((shard) => shard.always).id, 'core');
});

test('core is always selected, so the matrix is never empty', () => {
  // The whole safety argument for a dynamic matrix rests on this: an empty matrix would make
  // the suite report `skipped`, which the required aggregator would then have to interpret.
  for (const changedPaths of [[], ['README.md'], ['web-viewer-sample/src/App.tsx']]) {
    const result = selectShards(canonical, { changedPaths });
    assert.ok(result.shards.includes('core'), JSON.stringify(changedPaths));
    assert.ok(result.shards.length >= 1);
    assert.equal(result.reasons.core, 'always');
  }
});

test('an unaffected shard is not selected and therefore costs no runner', () => {
  const result = selectShards(canonical, { changedPaths: ['docs/agents/domain.md'] });
  assert.deepEqual([...result.shards], ['core']);
  assert.ok(!result.shards.includes('openspec'));
  assert.ok(!result.shards.includes('capability'));
  assert.ok(!result.shards.includes('evidence'));
});

test('each conditional shard is selected by its own surface, and reports why', () => {
  const cases = [
    ['openspec', 'openspec/changes/some-change/proposal.md'],
    ['openspec', 'scripts/lib/openspec-machine-truth.mjs'],
    ['capability', 'scripts/lib/detect-base-gate-capability.sh'],
    ['capability', 'scripts/tests/check-pr-body-evidence.ps1'],
    ['evidence', 'scripts/self-referential-bootstrap-ledger.json'],
    ['evidence', 'scripts/lib/design-system-gate.ps1'],
    ['evidence', 'scripts/lib/platform/windows/adapter.ps1'],
  ];
  for (const [shard, path] of cases) {
    const result = selectShards(canonical, { changedPaths: [path] });
    assert.ok(result.shards.includes(shard), `${path} should select ${shard}`);
    assert.equal(result.reasons[shard], `changed_path:${path}`);
  }
});

test('a full dispatch selects every leg, because path narrowing is untrustworthy for a self-change', () => {
  const result = selectShards(canonical, { changedPaths: ['scripts/verification-manifest.json'], full: true });
  assert.deepEqual([...result.shards].sort(), ['capability', 'core', 'evidence', 'openspec']);
  assert.equal(result.reasons.openspec, 'full_dispatch');
  assert.equal(result.reasons.core, 'always');
});

test('** spans separators and * does not', () => {
  const p = policy({
    shards: [
      { id: 'core', always: true, title: 'c', reason: 'r', path_globs: [] },
      { id: 'deep', always: false, title: 'd', reason: 'r', path_globs: ['a/**'] },
      { id: 'flat', always: false, title: 'f', reason: 'r', path_globs: ['b/*.md'] },
    ],
  });
  assert.ok(selectShards(p, { changedPaths: ['a/b/c/d.txt'] }).shards.includes('deep'));
  assert.ok(selectShards(p, { changedPaths: ['b/x.md'] }).shards.includes('flat'));
  assert.ok(!selectShards(p, { changedPaths: ['b/nested/x.md'] }).shards.includes('flat'), '* must not span a separator');
});

test('the declaration may never be widened into a gate', () => {
  assert.throws(() => validateShardPolicy(policy({ authority: 'required_check' })),
    (error) => error instanceof AgentGovernanceShardsError && error.field === 'authority');
  assert.throws(() => validateShardPolicy(policy({ schema_version: 'agent-governance-shards/v2' })),
    (error) => error.field === 'schema_version');
});

test('a declaration with no always-selected shard is rejected', () => {
  assert.throws(() => validateShardPolicy(policy({
    shards: [
      { id: 'a', always: false, title: 't', reason: 'r', path_globs: ['a/**'] },
      { id: 'b', always: false, title: 't', reason: 'r', path_globs: ['b/**'] },
    ],
  })), (error) => error.code === 'shards_invalid' && /always-selected/.test(error.message));
});

test('the CLI treats a fail-closed plan as a full dispatch, matching the workflow guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-governance-shards-'));
  const planPath = join(dir, 'plan.json');
  const cli = fileURLToPath(new URL('../dev/select-agent-governance-shards.mjs', import.meta.url));
  const policyPath = fileURLToPath(new URL('../agent-governance-shards.json', import.meta.url));
  const run = (plan) => {
    writeFileSync(planPath, JSON.stringify(plan));
    const result = spawnSync(process.execPath, [cli, '--plan', planPath, '--policy', policyPath, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const declared = canonical.shards.map((shard) => shard.id).sort();
  const failClosed = run({ schema_version: 'verification-plan/v2', result: 'fail_closed', dispatch: 'affected', changed_paths: ['mystery/unclassified.bin'] });
  assert.deepEqual([...failClosed.shards].sort(), declared);
  assert.equal(failClosed.full, true);
  const affected = run({ schema_version: 'verification-plan/v2', result: 'ok', dispatch: 'affected', changed_paths: ['docs/plans/NOW.md'] });
  assert.equal(affected.full, false);
});

test('the always-selected leg must be literally named core, because every verification step is bound to it', () => {
  const renamed = policy({ shards: canonical.shards.map((shard) => (shard.id === 'core' ? { ...shard, id: 'base' } : shard)) });
  assert.throws(() => selectShards(renamed, { changedPaths: [] }), /must be named core/);
});

test('an unreachable leg is rejected: neither always-on nor matched by anything', () => {
  assert.throws(() => validateShardPolicy(policy({
    shards: [
      { id: 'core', always: true, title: 't', reason: 'r', path_globs: [] },
      { id: 'ghost', always: false, title: 't', reason: 'r', path_globs: [] },
    ],
  })), (error) => error.field === 'shards[1].path_globs');
  // The mirror case: an always-on leg that also claims globs is ambiguous.
  assert.throws(() => validateShardPolicy(policy({
    shards: [
      { id: 'core', always: true, title: 't', reason: 'r', path_globs: ['x/**'] },
      { id: 'other', always: false, title: 't', reason: 'r', path_globs: ['y/**'] },
    ],
  })), (error) => error.field === 'shards[0].path_globs');
});

test('shape violations fail closed rather than silently narrowing the matrix', () => {
  assert.throws(() => validateShardPolicy({ ...policy(), extra: 1 }), (error) => error.code === 'shards_invalid');
  assert.throws(() => validateShardPolicy(policy({ shards: [{ id: 'only', always: true, title: 't', reason: 'r', path_globs: [] }] })),
    (error) => error.field === 'shards');
  assert.throws(() => validateShardPolicy(policy({
    shards: [
      { id: 'core', always: true, title: 't', reason: 'r', path_globs: [] },
      { id: 'core', always: false, title: 't', reason: 'r', path_globs: ['a/**'] },
    ],
  })), (error) => /Duplicate shard id/.test(error.message));
  assert.throws(() => selectShards(canonical, { changedPaths: 'not-an-array' }), (error) => error.code === 'shards_invalid');
});

test('selection is deterministic and reports the policy digest it used', () => {
  const a = selectShards(canonical, { changedPaths: ['openspec/x.md'] });
  const b = selectShards(canonical, { changedPaths: ['openspec/x.md'] });
  assert.deepEqual([...a.shards], [...b.shards]);
  assert.equal(a.policy_sha256, b.policy_sha256);
  assert.match(a.policy_sha256, /^[0-9a-f]{64}$/);
});
