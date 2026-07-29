import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  evaluateGitNexusWorktreeHealth,
  gitNexusWorktreeHealthVersions,
  normalizeRepositoryPath,
  validateGitNexusWorktreeObservation,
} from '../lib/gitnexus-worktree-health.mjs';
import { parseWorktreePorcelain } from '../dev/report-gitnexus-worktree-health.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..', '..');
const fixtureDirectory = resolve(testDirectory, 'fixtures', 'gitnexus-worktree-health');
const cliPath = resolve(repositoryRoot, 'scripts', 'dev', 'report-gitnexus-worktree-health.mjs');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadFixture(name) {
  return loadJson(resolve(fixtureDirectory, `${name}.json`));
}

const expectedFixtureResults = {
  clean: ['healthy', []],
  detached: ['unknown', ['canonical_index_freshness_unknown', 'current_checkout_detached']],
  dirty: ['warning', ['current_checkout_dirty']],
  'duplicate-registration': ['unhealthy', ['gitnexus_registration_duplicate']],
  'linked-worktree': ['unknown', ['current_checkout_index_unknown']],
  'missing-fts': ['unhealthy', ['gitnexus_fts_missing']],
  'prunable-worktree': ['warning', ['worktree_owner_ended', 'worktree_prunable']],
  'stale-index': ['unhealthy', ['canonical_index_not_origin_main', 'current_index_commit_mismatch', 'gitnexus_index_stale']],
  'wrong-registration': ['unhealthy', ['gitnexus_registration_path_mismatch']],
};

test('health fixtures produce deterministic status and finding codes', () => {
  const names = readdirSync(fixtureDirectory)
    .filter((name) => name.endsWith('.json'))
    .sort();
  assert.deepEqual(names, [
    'clean.json',
    'detached.json',
    'dirty.json',
    'duplicate-registration.json',
    'linked-worktree.json',
    'missing-fts.json',
    'prunable-worktree.json',
    'stale-index.json',
    'wrong-registration.json',
  ]);
  for (const name of names) {
    const caseName = name.replace(/\.json$/, '');
    const observation = loadJson(resolve(fixtureDirectory, name));
    const first = evaluateGitNexusWorktreeHealth(observation);
    const second = evaluateGitNexusWorktreeHealth(observation);
    assert.deepEqual(second, first, `${caseName} report must be deterministic`);
    assert.equal(first.schema_version, gitNexusWorktreeHealthVersions.report);
    assert.equal(first.overall_status, expectedFixtureResults[caseName][0], caseName);
    assert.deepEqual(first.findings.map((finding) => finding.code).sort(), expectedFixtureResults[caseName][1].sort(), caseName);
  }
});

test('linked worktree does not inherit the canonical checkout index', () => {
  const report = evaluateGitNexusWorktreeHealth(loadFixture('linked-worktree'));
  assert.equal(report.current_checkout.relationship, 'linked');
  assert.equal(report.gitnexus.index_freshness, 'fresh');
  assert.equal(report.gitnexus.current_checkout_trust, 'unknown');
  assert.equal(report.overall_status, 'unknown');
});

test('missing GitNexus observation fails closed as unknown', () => {
  const observation = structuredClone(loadFixture('clean'));
  observation.gitnexus = null;
  const report = evaluateGitNexusWorktreeHealth(observation);
  assert.equal(report.overall_status, 'unknown');
  assert.equal(report.gitnexus.current_checkout_trust, 'unknown');
  assert.deepEqual(report.findings.map((finding) => finding.code), ['gitnexus_observation_missing']);
});

test('registration normalization distinguishes duplicate records from path ambiguity', () => {
  const duplicateReport = evaluateGitNexusWorktreeHealth(loadFixture('duplicate-registration'));
  assert.equal(duplicateReport.gitnexus.registration_status, 'duplicate');

  const ambiguous = structuredClone(loadFixture('duplicate-registration'));
  ambiguous.gitnexus.registrations[1].path = 'C:/repo-copy';
  const ambiguousReport = evaluateGitNexusWorktreeHealth(ambiguous);
  assert.equal(ambiguousReport.gitnexus.registration_status, 'ambiguous');
  assert(ambiguousReport.findings.some((finding) => finding.code === 'gitnexus_registration_ambiguous'));
});

test('unique registration bound to an unrelated path is unhealthy', () => {
  const report = evaluateGitNexusWorktreeHealth(loadFixture('wrong-registration'));
  assert.equal(report.gitnexus.registration_status, 'unique');
  assert(report.findings.some((finding) => finding.code === 'gitnexus_registration_path_mismatch'));
  assert.equal(report.overall_status, 'unhealthy');
});

test('observation validator rejects unknown fields, invalid enums, and inconsistent current facts', () => {
  const clean = loadFixture('clean');
  assert.equal(validateGitNexusWorktreeObservation(clean), clean);

  const extra = structuredClone(clean);
  extra.repair = true;
  assert.throws(() => validateGitNexusWorktreeObservation(extra), /repair is not allowed/);

  const invalidFts = structuredClone(clean);
  invalidFts.gitnexus.fts_status = 'rebuilt';
  assert.throws(() => validateGitNexusWorktreeObservation(invalidFts), /fts_status is not recognized/);

  const inconsistent = structuredClone(clean);
  inconsistent.current_checkout.dirty = true;
  assert.throws(() => validateGitNexusWorktreeObservation(inconsistent), /dirty values disagree/);
});

test('Windows repository path normalization is case-insensitive and slash-stable', () => {
  assert.equal(normalizeRepositoryPath('C:\\Repo\\Feature\\'), 'c:/repo/feature');
  assert.equal(normalizeRepositoryPath('c:/repo/feature'), 'c:/repo/feature');
  assert.equal(normalizeRepositoryPath('/srv/Repo'), '/srv/Repo');
});

test('worktree porcelain parser preserves detached, locked, and prunable state', () => {
  const parsed = parseWorktreePorcelain([
    'worktree C:/repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree C:/repo/old',
    'HEAD 2222222222222222222222222222222222222222',
    'detached',
    'locked retained',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n'));
  assert.deepEqual(parsed, [
    { path: 'C:/repo', head_sha: '1111111111111111111111111111111111111111', branch: 'refs/heads/main', locked: false, prunable: false },
    { path: 'C:/repo/old', head_sha: '2222222222222222222222222222222222222222', branch: null, locked: true, prunable: true },
  ]);
});

test('prunable worktree emits an inert exact-target cleanup command with mandatory preconditions', () => {
  const report = evaluateGitNexusWorktreeHealth(loadFixture('prunable-worktree'));
  assert.deepEqual(report.manual_actions, [{
    action: 'inspect_then_remove_prunable_worktree',
    target: 'C:/repo.worktrees/old',
    requires_authorization: true,
    command_argv: ['git', 'worktree', 'remove', 'C:/repo.worktrees/old'],
    preconditions: ['exact_target_verified', 'not_deployment', 'clean', 'merged', 'unowned'],
  }]);
});

test('observation and report schemas are closed, versioned contracts', () => {
  const observationSchema = loadJson(resolve(testDirectory, 'gitnexus-worktree-health-observation.schema.json'));
  const reportSchema = loadJson(resolve(testDirectory, 'gitnexus-worktree-health-report.schema.json'));
  assert.equal(observationSchema.additionalProperties, false);
  assert.equal(reportSchema.additionalProperties, false);
  assert.equal(observationSchema.properties.schema_version.const, gitNexusWorktreeHealthVersions.observation);
  assert.equal(reportSchema.properties.schema_version.const, gitNexusWorktreeHealthVersions.report);
  assert.deepEqual(observationSchema.required, ['schema_version', 'repository_name', 'current_checkout', 'worktrees', 'gitnexus']);
  assert(reportSchema.required.includes('findings'));
  assert(reportSchema.required.includes('manual_actions'));
});

test('CLI emits only JSON and uses bounded exit codes for healthy, warning, and unknown reports', () => {
  const cases = [
    ['clean', 0],
    ['dirty', 1],
    ['linked-worktree', 2],
  ];
  for (const [name, expectedStatus] of cases) {
    const result = spawnSync(process.execPath, [cliPath, '--observation', resolve(fixtureDirectory, `${name}.json`)], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.status, expectedStatus, name);
    assert.equal(result.stderr, '', name);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schema_version, gitNexusWorktreeHealthVersions.report);
    assert.equal(report.overall_status, expectedFixtureResults[name][0]);
  }
});

test('health board snapshot cannot prune expired session evidence', (context) => {
  const temporaryRoot = resolve(repositoryRoot, '.tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  const boardDirectory = mkdtempSync(resolve(temporaryRoot, 'health-board-readonly-'));
  context.after(() => rmSync(boardDirectory, { recursive: true, force: true }));
  const sessionDirectory = resolve(boardDirectory, 'sessions');
  mkdirSync(sessionDirectory, { recursive: true });
  const sessionPath = resolve(sessionDirectory, 'worker--expired.json');
  const session = {
    agent: 'worker', session: 'expired', status: 'ended', task: '', cwd: 'C:/repo', branch: 'refs/heads/old',
    startedAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z', recentFiles: [],
  };
  writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  const before = { content: readFileSync(sessionPath, 'utf8'), mtime: statSync(sessionPath).mtimeMs };
  const result = spawnSync(process.execPath, [cliPath, '--format', 'json'], {
    cwd: repositoryRoot,
    env: { ...process.env, AGENTS_BOARD_DIR: boardDirectory },
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).schema_version, gitNexusWorktreeHealthVersions.report);
  assert.equal(existsSync(sessionPath), true);
  assert.equal(readFileSync(sessionPath, 'utf8'), before.content);
  assert.equal(statSync(sessionPath).mtimeMs, before.mtime);
});
