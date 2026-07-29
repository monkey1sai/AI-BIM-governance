import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateVerificationOutcome } from '../lib/verification-outcome.mjs';
import { createVerificationPlan } from '../lib/verification-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = path.join(root, 'scripts', 'lib', 'verification-runner.mjs');
const sourceManifest = JSON.parse(readFileSync(path.join(root, 'scripts', 'verification-manifest.json'), 'utf8'));
const subject = 'a'.repeat(40);

function command(file) {
  return { executable: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', `scripts/tests/fixtures/${file}`] };
}

function runFixture(configure) {
  const tempBase = path.join(root, 'artifacts', 'verification-outcomes');
  mkdirSync(tempBase, { recursive: true });
  const sandbox = mkdtempSync(path.join(tempBase, 'verification-runner-'));
  const manifest = structuredClone(sourceManifest);
  for (const target of manifest.targets) target.default_profiles = [];
  const target = manifest.targets.find(({ id }) => id === 'root-contracts');
  target.default_profiles = ['developer'];
  manifest.gates.find(({ id }) => id === 'root-contracts').command = command('verification-gate-pass.ps1');
  configure?.(manifest, target);
  const manifestPath = path.join(sandbox, 'manifest.json');
  const outcomePath = path.join(sandbox, 'outcome.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  const plan = createVerificationPlan(manifest, { defaultProfile: 'developer', subjectSha: subject });
  const result = spawnSync(process.execPath, [runner, '--repo-root', root, '--manifest', manifestPath,
    '--default-profile', 'developer', '--subject', subject, '--outcome-out', outcomePath], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  const outcome = JSON.parse(readFileSync(outcomePath, 'utf8'));
  return { result, outcome, plan, sandbox };
}

test('runner writes a complete subject-bound outcome for a passing gate', () => {
  const fixture = runFixture();
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr);
    validateVerificationOutcome(fixture.outcome, fixture.plan);
    assert.equal(fixture.outcome.result, 'passed');
    assert.deepEqual(fixture.outcome.gates.map(({ result, exit_code }) => [result, exit_code]), [['passed', 0]]);
  } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
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
  for (const args of [
    ['--subject', 'abc', '--outcome-out', 'artifacts/verification-outcomes/rejected.json'],
    ['--subject', subject, '--outcome-out', '../rejected.json'],
    ['--subject', subject, '--outcome-out', 'scripts/rejected.json'],
  ]) {
    const result = spawnSync(process.execPath, [runner, '--repo-root', root, '--manifest', path.join(root, 'scripts', 'verification-manifest.json'),
      '--default-profile', 'developer-none', ...args], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    assert.notEqual(result.status, 0);
  }
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
