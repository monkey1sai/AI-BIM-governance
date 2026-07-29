import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateMergeEvidence, finalizeMergeEvidence } from '../lib/merge-evidence.mjs';
import { createVerificationPlan } from '../lib/verification-plan.mjs';
import { readFileSync } from 'node:fs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'verification-manifest.json'), 'utf8'));
const baseSha = '1'.repeat(40);
const subjectSha = '2'.repeat(40);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeEvidence(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
  return digest(Buffer.isBuffer(value) ? value : Buffer.from(value));
}

function buildFixture(changedPaths, options = {}) {
  const tempRoot = path.join(repoRoot, 'artifacts', 'tmp');
  mkdirSync(tempRoot, { recursive: true });
  const sandbox = mkdtempSync(path.join(tempRoot, 'merge-evidence-'));
  const plan = createVerificationPlan(manifest, { changedPaths, baseSha, subjectSha });
  if (options.mutatePlan) options.mutatePlan(plan);
  const planBytes = Buffer.from(`${JSON.stringify(plan)}\n`, 'utf8');
  const artifacts = [{
    id: 501, name: `verification-plan-${subjectSha}-attempt-1`, size_in_bytes: planBytes.length, expired: false,
    source_run_id: 42, source_run_attempt: 1, subject_sha: subjectSha,
  }];
  const requiredJobs = new Set(plan.targets.filter(({ required }) => required).map(({ ci_job: name }) => name));
  const allJobs = [...new Set(plan.targets.map(({ ci_job: name }) => name))];
  const jobs = [{ name: 'changed path classifier', conclusion: 'success' },
    ...allJobs.map((name) => ({ name, conclusion: requiredJobs.has(name) ? 'success' : 'skipped' }))];
  const designRequired = plan.targets.some(({ id, required }) => id === 'design-semantic-visual' && required);
  const visualRequired = options.visualRequired ?? designRequired;
  const designScope = {
    schema_version: 'design-scope/v1', base_sha: baseSha, subject_sha: subjectSha,
    status: designRequired ? (visualRequired ? 'passed' : 'partial_reference_missing') : 'not_applicable',
    frontend_product: designRequired,
    visual_required: visualRequired,
    full_completion_allowed: designRequired ? visualRequired : false,
    required_screen_ids: visualRequired ? ['edge-console'] : [],
    reference_missing_items: designRequired && !visualRequired ? ['surface:kit-manager-web'] : [],
  };
  for (const target of plan.targets.filter(({ required, result_artifact: contract }) => required && contract !== null)) {
    if (target.id === 'design-semantic-visual' && !visualRequired) continue;
    const artifactName = `${target.result_artifact.artifact_name_prefix}${subjectSha}-attempt-1`;
    const artifactRoot = path.join(sandbox, artifactName);
    mkdirSync(artifactRoot, { recursive: true });
    let result;
    if (target.id === 'functional-runtime-conv') {
      const imagePath = 'artifacts/e2e/functional-runtime/conv-history.png';
      const tracePath = 'artifacts/e2e/functional-runtime/conv-history-trace.zip';
      const imageHash = writeEvidence(artifactRoot, imagePath, Buffer.from('image'));
      const traceHash = writeEvidence(artifactRoot, tracePath, Buffer.from('trace'));
      result = {
        schema_version: 1, kind: 'ai-bim-functional-runtime-result', status: 'passed',
        subject_commit: subjectSha, workspace_clean: true, skipped: false, blocked: false,
        artifacts: [
          { role: 'screenshot', path: imagePath, sha256: imageHash },
          { role: 'trace', path: tracePath, sha256: traceHash },
        ],
      };
    } else {
      const actualPath = 'artifacts/e2e/design-system-visual/edge-console/desktop.actual.png';
      const diffPath = 'artifacts/e2e/design-system-visual/edge-console/desktop.diff.png';
      const actualHash = writeEvidence(artifactRoot, actualPath, Buffer.from('actual'));
      const diffHash = writeEvidence(artifactRoot, diffPath, Buffer.from('diff'));
      result = {
        schema_version: 2, kind: 'ai-bim-design-system-visual-result', status: 'passed',
        subject_commit: subjectSha, workspace_clean: true,
        screens: [{ id: 'edge-console', semantic_parity: 1, viewports: [{
          id: 'desktop', actual_path: actualPath, actual_sha256: actualHash, diff_path: diffPath, diff_sha256: diffHash,
        }] }],
      };
    }
    const resultBytes = Buffer.from(`${JSON.stringify(result)}\n`, 'utf8');
    writeEvidence(artifactRoot, target.result_artifact.result_path, resultBytes);
    artifacts.push({
      id: 501 + artifacts.length, name: artifactName, size_in_bytes: resultBytes.length + 100, expired: false,
      source_run_id: 42, source_run_attempt: 1, subject_sha: subjectSha,
    });
  }
  const jobResults = {
    schema_version: 'verification-job-results/v1', authority: options.authority ?? 'trusted_base',
    repository: 'example/repository', repository_id: 99, source_workflow: 'CI', source_workflow_id: 101,
    source_workflow_path: '.github/workflows/ci.yml',
    source_run_id: 42, source_run_attempt: 1, event_name: 'pull_request', pull_request_number: 7,
    body_sha256: '3'.repeat(64),
    base_ref: 'main', base_sha: baseSha, subject_sha: subjectSha, live_head_sha: subjectSha, source_conclusion: 'success', jobs, artifacts,
  };
  return {
    sandbox, plan, planBytes, jobResults, designScope,
    evaluate(overrides = {}) {
      return evaluateMergeEvidence({
        trustedPlanBytes: overrides.trustedPlanBytes ?? planBytes,
        candidatePlanBytes: overrides.candidatePlanBytes ?? planBytes,
        jobResults: overrides.jobResults ?? jobResults,
        designScope: overrides.designScope ?? designScope,
        artifactsRoot: sandbox,
        expected: overrides.expected ?? {
          repository: 'example/repository', repository_id: 99, source_workflow_id: 101, base_ref: 'main',
          source_run_id: 42, source_run_attempt: 1, pull_request_number: 7,
        },
      });
    },
  };
}

function withFixture(changedPaths, options, callback) {
  const fixture = buildFixture(changedPaths, options);
  try { callback(fixture); } finally { rmSync(fixture.sandbox, { recursive: true, force: true }); }
}

for (const [name, paths, expectedRequired] of [
  ['docs-only', ['docs/architecture/overview.md'], ['secret-pattern-scan']],
  ['backend', ['governance-service/app.py'], ['governance', 'root-contracts', 'secret-pattern-scan']],
  ['user-facing', ['web-viewer-sample/src/console/pages.tsx'],
    ['design-semantic-visual', 'functional-runtime-conv', 'root-contracts', 'secret-pattern-scan', 'viewer', 'viewer-session']],
  ['mixed', ['web-viewer-sample/src/console/pages.tsx', 'governance-service/app.py'],
    ['design-semantic-visual', 'functional-runtime-conv', 'governance', 'root-contracts', 'secret-pattern-scan', 'viewer', 'viewer-session']],
]) {
  test(`${name} plan produces reproducible merge evidence`, () => withFixture(paths, {}, ({ evaluate }) => {
    const report = evaluate();
    assert.equal(report.result, 'prevalidated', JSON.stringify(report.errors));
    assert.equal(report.semantic_validation, 'pending');
    assert.deepEqual(report.outcomes.filter(({ required }) => required).map(({ target_id }) => target_id).sort(), expectedRequired);
    assert.equal(report.outcomes.find(({ target_id }) => target_id === 'secret-pattern-scan').evidence_result, 'incomplete');
    assert.equal(report.full_completion, false);
  }));
}

test('reference-missing frontend produces a typed skip and forbids full-completion claims', () =>
  withFixture(['apps/kit-manager-web/src/main.ts'], { visualRequired: false }, ({ evaluate }) => {
    const report = evaluate();
    assert.equal(report.result, 'prevalidated', JSON.stringify(report.errors));
    assert.equal(report.full_completion, false);
    assert.equal(report.summary.typed_skip_count, 1);
    assert.equal(report.outcomes.find(({ target_id }) => target_id === 'design-semantic-visual').evidence_result, 'typed_skip');
  }));

test('shallow artifact bytes cannot become passed before every base semantic validator completes', () =>
  withFixture(['web-viewer-sample/src/console/pages.tsx'], {}, ({ evaluate }) => {
    const preliminary = evaluate();
    assert.equal(preliminary.result, 'prevalidated');
    assert.equal(preliminary.full_completion, false);
    const incomplete = finalizeMergeEvidence(preliminary, {
      schema_version: 'semantic-validation-results/v1', subject_sha: subjectSha, validators: [],
    });
    assert.equal(incomplete.result, 'failed');
    assert.ok(incomplete.errors.some(({ code }) => code === 'semantic_validation_invalid'));
    const completed = finalizeMergeEvidence(preliminary, {
      schema_version: 'semantic-validation-results/v1', subject_sha: subjectSha,
      validators: [
        { target_id: 'functional-runtime-conv', validator: 'functional-runtime-result/v1', result: 'passed' },
        { target_id: 'design-semantic-visual', validator: 'design-system-visual-result/v2', result: 'passed' },
      ],
    });
    assert.equal(completed.result, 'passed');
    assert.equal(completed.semantic_validation, 'complete');
    assert.equal(completed.full_completion, false);
  }));

for (const conclusion of ['skipped', 'cancelled', 'neutral', 'failure']) {
  test(`required job conclusion ${conclusion} fails closed`, () =>
    withFixture(['governance-service/app.py'], {}, ({ evaluate, jobResults }) => {
      jobResults.jobs.find(({ name }) => name === 'governance-service tests').conclusion = conclusion;
      const report = evaluate();
      assert.equal(report.result, 'failed');
      assert.ok(report.errors.some(({ code }) => code === 'job_conclusion_invalid'));
    }));
}

test('candidate plan mismatch and stale live head both fail closed', () =>
  withFixture(['governance-service/app.py'], {}, ({ evaluate, plan, jobResults }) => {
    const candidate = structuredClone(plan);
    candidate.targets[0].display_name = 'tampered display';
    const changedPlan = Buffer.from(`${JSON.stringify(candidate)}\n`, 'utf8');
    const mismatch = evaluate({ candidatePlanBytes: changedPlan });
    assert.equal(mismatch.result, 'failed');
    assert.ok(mismatch.errors.some(({ code }) => code === 'plan_mismatch'));
    jobResults.live_head_sha = '3'.repeat(40);
    const stale = evaluate();
    assert.equal(stale.result, 'failed');
    assert.ok(stale.errors.some(({ code }) => code === 'subject_mismatch'));
  }));

test('missing or cross-run result artifacts fail closed', () =>
  withFixture(['web-viewer-sample/src/console/pages.tsx'], {}, ({ evaluate, jobResults }) => {
    jobResults.artifacts = jobResults.artifacts.filter(({ name }) => !name.startsWith('functional-runtime-conv-'));
    const missing = evaluate();
    assert.equal(missing.result, 'failed');
    assert.ok(missing.errors.some(({ code, target_id: id }) => code === 'artifact_missing' && id === 'functional-runtime-conv'));
  }));

test('string false cannot satisfy typed evidence booleans', () =>
  withFixture(['web-viewer-sample/src/console/pages.tsx'], {}, ({ evaluate, sandbox }) => {
    const resultPath = path.join(sandbox, `functional-runtime-conv-${subjectSha}-attempt-1`, 'artifacts', 'e2e', 'functional-runtime', 'functional-runtime-result.json');
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    result.workspace_clean = 'false';
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    const report = evaluate();
    assert.equal(report.result, 'failed');
    assert.ok(report.errors.some(({ code }) => code === 'artifact_invalid'));
  }));

test('self-change and bootstrap plans cannot grant merge authority', () => {
  withFixture(['.github/workflows/ci.yml'], {}, ({ evaluate }) => {
    const report = evaluate();
    assert.equal(report.result, 'failed');
    assert.ok(report.errors.some(({ code }) => code === 'self_change_requires_two_phase'));
  });
  withFixture(['docs/architecture/overview.md'], { authority: 'bootstrap_untrusted' }, ({ evaluate }) => {
    const report = evaluate();
    assert.equal(report.result, 'bootstrap_only');
    assert.ok(report.errors.some(({ code }) => code === 'bootstrap_not_authoritative'));
  });
});

test('shared CI job is required when any mapped target is required', () =>
  withFixture(['web-viewer-sample/src/console/pages.tsx'], { mutatePlan(plan) {
    plan.targets.find(({ id }) => id === 'viewer').required = false;
    plan.targets.find(({ id }) => id === 'viewer').reason = 'path_not_affected';
  } }, ({ evaluate, jobResults }) => {
    jobResults.jobs.find(({ name }) => name === 'viewer build and tests').conclusion = 'skipped';
    const report = evaluate();
    assert.equal(report.result, 'failed');
    assert.ok(report.errors.some(({ code, target_id: id }) => code === 'job_conclusion_invalid' && id === 'viewer'));
  }));
