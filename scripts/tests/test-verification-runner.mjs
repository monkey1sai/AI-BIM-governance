import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateVerificationOutcome } from '../lib/verification-outcome.mjs';
import { createVerificationPlan } from '../lib/verification-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = path.join(root, 'scripts', 'lib', 'verification-runner.mjs');
const sourceManifest = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-manifest.json'), 'utf8'));
function command(file) {
  return { executable: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', `scripts/tests/fixtures/${file}`] };
}

function git(sandbox, args) {
  const result = spawnSync('git', args, { cwd: sandbox, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.stderr || 'fixture git command failed');
  return result.stdout.trim();
}

function createFixtureRepository(configure) {
  const tempBase = path.join(root, 'artifacts', 'tmp');
  mkdirSync(tempBase, { recursive: true });
  const sandbox = mkdtempSync(path.join(tempBase, 'verification-runner-'));
  const manifest = structuredClone(sourceManifest);
  for (const target of manifest.targets) target.default_profiles = [];
  const target = manifest.targets.find(({ id }) => id === 'root-contracts');
  target.default_profiles = ['developer'];
  manifest.gates.find(({ id }) => id === 'root-contracts').command = command('verification-gate-pass.ps1');
  configure?.(manifest, target);
  mkdirSync(path.join(sandbox, 'scripts', 'tests', 'fixtures'), { recursive: true });
  writeFileSync(path.join(sandbox, '.gitignore'), 'artifacts/verification-outcomes/\n');
  writeFileSync(path.join(sandbox, 'scripts', 'tests', 'fixtures', 'verification-gate-pass.ps1'), 'exit 0\n');
  writeFileSync(path.join(sandbox, 'scripts', 'tests', 'fixtures', 'verification-gate-fail.ps1'), 'exit 17\n');
  const manifestPath = path.join(sandbox, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  git(sandbox, ['init']);
  git(sandbox, ['config', 'user.email', 'verification-runner@example.test']);
  git(sandbox, ['config', 'user.name', 'Verification Runner Test']);
  git(sandbox, ['add', '.']);
  git(sandbox, ['commit', '-m', 'fixture']);
  return { sandbox, manifest, manifestPath, subject: git(sandbox, ['rev-parse', 'HEAD']) };
}

function runFixture(configure, beforeRun) {
  const { sandbox, manifest, manifestPath, subject } = createFixtureRepository(configure);
  const outcomePath = path.join(sandbox, 'artifacts', 'verification-outcomes', 'outcome.json');
  const plan = createVerificationPlan(manifest, { defaultProfile: 'developer', subjectSha: subject });
  beforeRun?.({ sandbox, subject });
  const result = spawnSync(process.execPath, [runner, '--repo-root', sandbox, '--manifest', manifestPath,
    '--default-profile', 'developer', '--subject', subject, '--outcome-out', outcomePath], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  const outcome = existsSync(outcomePath) ? JSON.parse(readFileSync(outcomePath, 'utf8')) : null;
  return { result, outcome, plan, sandbox };
}

test('runner writes a complete subject-bound outcome for a passing gate', () => {
  const fixture = runFixture();
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    assert.equal(existsSync(path.join(fixture.sandbox, 'artifacts', 'verification-outcomes')), true);
    validateVerificationOutcome(fixture.outcome, fixture.plan);
    assert.equal(fixture.outcome.result, 'passed');
    assert.deepEqual(fixture.outcome.gates.map(({ result, exit_code }) => [result, exit_code]), [['passed', 0]]);
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
});

test('--base is accepted as plan provenance and must be a full lowercase commit id', () => {
  const { sandbox, manifestPath, subject } = createFixtureRepository();
  try {
    const accepted = spawnSync(process.execPath, [runner, '--repo-root', sandbox, '--manifest', manifestPath,
      '--default-profile', 'developer', '--base', subject, '--plan-only', '--json'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).base_sha, subject);
    const rejected = spawnSync(process.execPath, [runner, '--repo-root', sandbox, '--manifest', manifestPath,
      '--default-profile', 'developer', '--base', 'not-a-commit', '--plan-only'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(rejected.status, 3);
    assert.match(rejected.stderr, /--base requires a lowercase full commit id/u);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test('required failure exits nonzero and records later configured gates as not_run', () => {
  const fixture = runFixture((manifest, target) => {
    manifest.gates.find(({ id }) => id === 'root-contracts').command = command('verification-gate-fail.ps1');
    manifest.gates.push({ id: 'fixture-after', capabilities: ['contract'], enforcement: 'required',
      command: command('verification-gate-pass.ps1'), cwd: '.', evidence_class: 'contract', configured: true, not_configured_reason: null });
    target.contract_gates.push('fixture-after');
  });
  try {
    assert.equal(fixture.result.status, 1);
    validateVerificationOutcome(fixture.outcome, fixture.plan);
    assert.equal(fixture.outcome.result, 'failed');
    assert.deepEqual(fixture.outcome.gates.map(({ result, exit_code, reason }) => [result, exit_code, reason]),
      [['failed', 17, 'exit_nonzero'], ['not_run', null, 'fail_fast']]);
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
});

test('not_configured is typed as incomplete and advisory failure stays non-blocking', () => {
  const skipped = runFixture((manifest, target) => {
    manifest.gates.push({ id: 'fixture-missing', capabilities: ['lint'], enforcement: 'advisory', command: null,
      cwd: '.', evidence_class: 'fast', configured: false, not_configured_reason: 'tooling_absent' });
    target.fast_gates.unshift('fixture-missing');
  });
  try {
    assert.equal(skipped.result.status, 0);
    assert.equal(skipped.outcome.result, 'incomplete');
    assert.equal(skipped.outcome.gates[0].result, 'not_configured');
  } finally { rmSync(skipped.sandbox, { recursive: true, force: true }); }

  const advisory = runFixture((manifest) => {
    const gate = manifest.gates.find(({ id }) => id === 'root-contracts');
    gate.enforcement = 'advisory'; gate.command = command('verification-gate-fail.ps1');
  });
  try {
    assert.equal(advisory.result.status, 0);
    assert.equal(advisory.outcome.result, 'passed_with_advisories');
    assert.equal(advisory.outcome.gates[0].result, 'failed');
  } finally { rmSync(advisory.sandbox, { recursive: true, force: true }); }
});

test('outcome mode rejects abbreviated subject and repository escape', () => {
  const fixture = createFixtureRepository();
  try {
    for (const args of [
      ['--subject', 'abc', '--outcome-out', 'artifacts/verification-outcomes/rejected.json'],
      ['--subject', fixture.subject, '--outcome-out', '../rejected.json'],
      ['--subject', fixture.subject, '--outcome-out', 'scripts/rejected.json'],
    ]) {
      const result = spawnSync(process.execPath, [runner, '--repo-root', fixture.sandbox, '--manifest', fixture.manifestPath,
        '--default-profile', 'developer-none', ...args], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
      assert.notEqual(result.status, 0);
    }
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
});

test('outcome mode rejects a stale subject or a dirty working tree', () => {
  const stale = runFixture(undefined, ({ sandbox }) => { git(sandbox, ['commit', '--allow-empty', '-m', 'head drift']); });
  try {
    assert.notEqual(stale.result.status, 0);
    assert.equal(stale.outcome, null);
  } finally { rmSync(stale.sandbox, { recursive: true, force: true }); }

  const dirty = runFixture(undefined, ({ sandbox }) => { writeFileSync(path.join(sandbox, 'dirty.txt'), 'dirty\n'); });
  try {
    assert.notEqual(dirty.result.status, 0);
    assert.equal(dirty.outcome, null);
  } finally { rmSync(dirty.sandbox, { recursive: true, force: true }); }
});

test('outcome validator rejects malformed typed fields', () => {
  const fixture = runFixture();
  try {
    for (const mutate of [
      (value) => { value.gates[0].command = {}; },
      (value) => { value.gates[0].cwd = 42; },
      (value) => { value.gates[0].capabilities = ['arbitrary']; },
      (value) => { value.gates[0].gate_id = '../escape'; },
      (value) => { value.dispatch = 'unknown'; },
      (value) => { value.started_at = 'not-a-timestamp'; },
    ]) {
      const invalid = structuredClone(fixture.outcome);
      mutate(invalid);
      assert.throws(() => validateVerificationOutcome(invalid));
    }
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
});

test('outcome validator derives aggregate truth and binds the exact trusted plan gate set', () => {
  const fixture = runFixture();
  try {
    const empty = structuredClone(fixture.outcome);
    empty.gates = [];
    assert.throws(() => validateVerificationOutcome(empty));
    const failed = structuredClone(fixture.outcome);
    failed.gates[0].result = 'failed'; failed.gates[0].exit_code = 1; failed.gates[0].reason = 'exit_nonzero';
    assert.throws(() => validateVerificationOutcome(failed));
    const duplicate = structuredClone(fixture.outcome);
    duplicate.gates.push(structuredClone(duplicate.gates[0]));
    assert.throws(() => validateVerificationOutcome(duplicate));
    const missing = structuredClone(fixture.outcome);
    missing.gates = [];
    missing.result = 'incomplete';
    assert.throws(() => validateVerificationOutcome(missing, fixture.plan));
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
});
