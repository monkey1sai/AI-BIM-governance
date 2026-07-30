import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  VerificationPlanError,
  createVerificationPlan,
  validateVerificationManifest,
} from '../lib/verification-plan.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '..', '..');
const manifestPath = path.join(repoRoot, 'scripts', 'verification-manifest.json');
const plannerPath = path.join(repoRoot, 'scripts', 'lib', 'verification-plan.mjs');
const runnerPath = path.join(repoRoot, 'scripts', 'lib', 'verification-runner.mjs');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function requiredIds(plan) {
  return plan.targets.filter(({ required }) => required).map(({ id }) => id).sort();
}

function requiredIdsInOrder(plan) {
  return plan.targets.filter(({ required }) => required).map(({ id }) => id);
}

test('manifest semantic validation and developer profile preserve the legacy four-target plan', () => {
  validateVerificationManifest(manifest);
  const plan = createVerificationPlan(manifest, { defaultProfile: 'developer' });
  assert.equal(plan.schema_version, 'verification-plan/v2');
  assert.deepEqual(requiredIds(plan), ['coordinator', 'root-contracts', 'streaming', 'viewer']);
  assert.deepEqual(requiredIdsInOrder(plan), ['root-contracts', 'coordinator', 'viewer', 'streaming']);
  const commands = Object.fromEntries(plan.targets.filter(({ required }) => required)
    .map((target) => [target.id, target.gates[0].command]));
  assert.deepEqual(commands['root-contracts'], {
    executable: 'python', args: ['-m', 'pytest', 'tests', '-q', '-p', 'no:cacheprovider'],
  });
  assert.deepEqual(commands.coordinator, { executable: 'npm', args: ['run', 'verify'] });
  assert.deepEqual(commands.viewer, { executable: 'npm', args: ['run', 'verify'] });
  assert.deepEqual(commands.streaming, {
    executable: 'pwsh',
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/tests/test-stage-loading-contract.ps1'],
  });
  for (const targetId of manifest.quality_policy.service_targets) {
    const target = plan.targets.find(({ id }) => id === targetId);
    const capabilities = new Set(target.gates.flatMap(({ capabilities: values }) => values));
    assert.ok(capabilities.has('types') && capabilities.has('lint') && (capabilities.has('unit') || capabilities.has('contract')));
  }
});

test('legacy developer filters are represented by closed manifest profiles', () => {
  const fixtures = [
    ['developer-ts', ['coordinator', 'viewer']],
    ['developer-py', ['root-contracts']],
    ['developer-streaming', ['streaming']],
    ['developer-none', []],
  ];
  for (const [profile, expected] of fixtures) {
    assert.deepEqual(requiredIdsInOrder(createVerificationPlan(manifest, { defaultProfile: profile })), expected);
  }
});

const fixtures = [
  ['streaming service', ['bim-streaming-server/server.py'], ['root-contracts', 'secret-pattern-scan', 'streaming']],
  ['governance service', ['governance-service/app.py'], ['governance', 'root-contracts', 'secret-pattern-scan']],
  ['kit manager api', ['services/kit-manager-api/app.py'], ['kit-manager-api', 'kit-manager-web', 'root-contracts', 'secret-pattern-scan']],
  ['kit manager web', ['apps/kit-manager-web/src/main.ts'], ['design-semantic-visual', 'kit-manager-web', 'root-contracts', 'secret-pattern-scan']],
  ['viewer user surface', ['web-viewer-sample/src/console/pages.tsx'], ['design-semantic-visual', 'functional-runtime-conv', 'root-contracts', 'secret-pattern-scan', 'viewer', 'viewer-session']],
  ['coordinator source', ['bim-review-coordinator/src/app.ts'], ['coordinator', 'design-semantic-visual', 'functional-runtime-conv', 'root-contracts', 'secret-pattern-scan', 'viewer', 'viewer-session']],
  ['governance document', ['docs/agents/domain.md'], ['agent-governance', 'powershell-static', 'secret-pattern-scan']],
  ['compose config', ['compose.runtime-manager.yml'], ['compose-config', 'secret-pattern-scan']],
];

for (const [name, changedPaths, expected] of fixtures) {
  test(`affected-path fixture: ${name}`, () => {
    const plan = createVerificationPlan(manifest, { changedPaths });
    assert.equal(plan.result, 'planned');
    assert.deepEqual(requiredIds(plan), expected);
    assert.ok(plan.targets.filter(({ required }) => required).every(({ reason }) => reason === 'affected_path'));
  });
}

test('docs-only paths produce typed skips while the security scan remains explicit', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['docs/architecture/overview.md'] });
  assert.deepEqual(requiredIds(plan), ['secret-pattern-scan']);
  assert.ok(plan.targets.filter(({ required }) => !required).every(({ reason }) => reason === 'docs_only'));
});

test('workflow and manifest self-changes force every target', () => {
  for (const changedPath of [
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    'scripts/verification-manifest.json',
    'scripts/lib/verification-plan.mjs',
    'scripts/lib/verification-command-policy.mjs',
    'scripts/lib/verification-outcome.mjs',
    'scripts/security-exceptions.json',
    'scripts/lib/collect-openspec-github-state.mjs',
    'scripts/lib/design-system-gate.ps1',
    'scripts/tests/check-pr-body-evidence.ps1',
    'scripts/tests/verify-design-system-reference.ps1',
    'scripts/tests/verify-design-system-visual-result.ps1',
    'scripts/tests/verify-functional-runtime-result.ps1',
    'docs/plans/design-system-reference.manifest.json',
    'docs/plans/design-system-baseline/edge-console-desktop.png',
    'web-viewer-sample/scripts/capture-design-system-reference.mjs',
    'web-viewer-sample/scripts/verify-design-system-pixels.mjs',
    'web-viewer-sample/scripts/eslint-baseline.json',
    'web-viewer-sample/scripts/lib/png-preflight.mjs',
    'web-viewer-sample/package.json',
    'web-viewer-sample/playwright.design-system.config.ts',
    'web-viewer-sample/e2e/design-system-visual.spec.ts',
    'web-viewer-sample/e2e/conv-history.spec.ts',
    'bim-review-coordinator/package-lock.json',
  ]) {
    const plan = createVerificationPlan(manifest, { changedPaths: [changedPath] });
    assert.equal(plan.dispatch, 'full');
    assert.equal(requiredIds(plan).length, manifest.targets.length);
    assert.ok(plan.targets.every(({ reason }) => reason === 'full_dispatch_self_change'));
  }
});

test('unknown paths fail closed and cannot become silent skips', () => {
  const plan = createVerificationPlan(manifest, { changedPaths: ['new-unowned-service/source.xyz'] });
  assert.equal(plan.result, 'fail_closed');
  assert.deepEqual(plan.unknown_paths, ['new-unowned-service/source.xyz']);
  assert.ok(plan.targets.every(({ required, reason }) => required && reason === 'unknown_path_fail_closed'));
});

test('mixed paths use the union of affected classes and output is byte stable', () => {
  const options = { changedPaths: ['docs/architecture/overview.md', 'governance-service/app.py'] };
  const first = createVerificationPlan(manifest, options);
  const second = createVerificationPlan(manifest, { changedPaths: [...options.changedPaths].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(requiredIds(first), ['governance', 'root-contracts', 'secret-pattern-scan']);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('explicit full dispatch requires all targets with a typed reason', () => {
  const plan = createVerificationPlan(manifest, { full: true });
  assert.equal(plan.dispatch, 'full');
  assert.ok(plan.targets.every(({ required, reason }) => required && reason === 'full_dispatch_requested'));
});

test('profile and affected-path modes cannot be combined', () => {
  assert.throws(() => createVerificationPlan(manifest, {
    defaultProfile: 'developer', changedPaths: ['governance-service/app.py'],
  }), (error) => error instanceof VerificationPlanError && error.code === 'invalid_argument');
});

test('unknown predicates, gate references and traversing paths fail before planning', () => {
  const badPredicate = structuredClone(manifest);
  badPredicate.targets[0].required_when.predicate = 'eval_this';
  assert.throws(() => validateVerificationManifest(badPredicate), VerificationPlanError);
  const badGate = structuredClone(manifest);
  badGate.targets[0].fast_gates.push('missing-gate');
  assert.throws(() => validateVerificationManifest(badGate), VerificationPlanError);
  assert.throws(() => createVerificationPlan(manifest, { changedPaths: ['../escape'] }), VerificationPlanError);
  const badArtifact = structuredClone(manifest);
  badArtifact.targets.find(({ id }) => id === 'functional-runtime-conv').result_artifact.result_path = 'artifacts/e2e/..\\outside.json';
  assert.throws(() => validateVerificationManifest(badArtifact), VerificationPlanError);
  const inlineCommand = structuredClone(manifest);
  inlineCommand.gates.find(({ id }) => id === 'powershell-static').command.args = ['-NoProfile', '-Command', 'Write-Host unsafe'];
  assert.throws(() => validateVerificationManifest(inlineCommand),
    (error) => error instanceof VerificationPlanError && error.code === 'manifest_command_unsafe');
  const fakeAttestation = structuredClone(manifest);
  fakeAttestation.artifact_policy.deployable_kinds.push('screenshot');
  assert.throws(() => validateVerificationManifest(fakeAttestation), VerificationPlanError);
  const fakeConfiguredScan = structuredClone(manifest);
  const dependencyGate = fakeConfiguredScan.gates.find(({ id }) => id === 'dependency-review');
  dependencyGate.command = { executable: 'npm', args: ['run', 'verify'] };
  assert.throws(() => validateVerificationManifest(fakeConfiguredScan), VerificationPlanError);
});

test('plan binds exact base and subject commits and rejects abbreviated values', () => {
  const baseSha = '1'.repeat(40);
  const subjectSha = '2'.repeat(40);
  const plan = createVerificationPlan(manifest, {
    changedPaths: ['governance-service/app.py'], baseSha, subjectSha,
  });
  assert.equal(plan.base_sha, baseSha);
  assert.equal(plan.subject_sha, subjectSha);
  assert.throws(() => createVerificationPlan(manifest, {
    changedPaths: ['governance-service/app.py'], baseSha: 'abc', subjectSha,
  }), VerificationPlanError);
});

test('CLI consumer returns the same semantic plan as the library consumer', () => {
  const expected = createVerificationPlan(manifest, { changedPaths: ['governance-service/app.py'] });
  const baseSha = '1'.repeat(40);
  const subjectSha = '2'.repeat(40);
  const expectedBound = createVerificationPlan(manifest, {
    changedPaths: ['governance-service/app.py'], baseSha, subjectSha,
  });
  const result = spawnSync(process.execPath, [plannerPath, '--manifest', manifestPath, '--path', 'governance-service/app.py',
    '--base', baseSha, '--subject', subjectSha], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), expectedBound);

  const full = spawnSync(process.execPath, [plannerPath, '--manifest', manifestPath, '--full'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
  assert.equal(full.status, 0, full.stderr);
  assert.equal(JSON.parse(full.stdout).dispatch, 'full');

  const runner = spawnSync(process.execPath, [runnerPath, '--repo-root', repoRoot, '--manifest', manifestPath,
    '--path', 'governance-service/app.py', '--plan-only', '--json'], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
  assert.equal(runner.status, 0, runner.stderr);
  assert.deepEqual(JSON.parse(runner.stdout), expected);
});

test('NUL-delimited CI input preserves one shared plan and aggregates duplicate job outputs', () => {
  const tempRoot = path.join(repoRoot, 'artifacts', 'tmp');
  mkdirSync(tempRoot, { recursive: true });
  const sandbox = mkdtempSync(path.join(tempRoot, 'verification-plan-'));
  try {
    const changedPathFile = path.join(sandbox, 'changed-paths.bin');
    const jsonOut = path.join(sandbox, 'plan.json');
    const githubOutput = path.join(sandbox, 'github-output.txt');
    writeFileSync(changedPathFile, Buffer.from('web-viewer-sample/src/console/pages.tsx\0', 'utf8'));
    const result = spawnSync(process.execPath, [plannerPath, '--manifest', manifestPath,
      '--changed-paths0-file', changedPathFile, '--json-out', jsonOut, '--github-output', githubOutput], {
      encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(jsonOut, 'utf8')), JSON.parse(result.stdout));
    const outputs = readFileSync(githubOutput, 'utf8').trim().split(/\r?\n/u);
    assert.equal(outputs.filter((line) => line.startsWith('viewer=')).length, 1);
    assert.ok(outputs.includes('viewer=true'));
    assert.ok(outputs.includes('root_contracts=true'));
    assert.ok(outputs.some((line) => /^plan_sha256=[0-9a-f]{64}$/u.test(line)));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
