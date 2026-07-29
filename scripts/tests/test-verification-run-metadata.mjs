import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWorkflowRunObservation, filterArtifactsForAttempt, isCurrentSourceRun } from '../lib/verification-run-metadata.mjs';

const baseSha = '1'.repeat(40);
const subjectSha = '2'.repeat(40);

function fixture() {
  return {
    repository: 'example/repository',
    authority: 'trusted_base',
    repositoryInfo: { id: 99, full_name: 'example/repository', default_branch: 'main' },
    run: {
      id: 42, name: 'CI', workflow_id: 7, run_attempt: 3, event: 'pull_request', head_sha: subjectSha,
      conclusion: 'success', repository: { id: 99, full_name: 'example/repository' },
      pull_requests: [{ number: 8, head: { sha: subjectSha }, base: { sha: baseSha, ref: 'main', repo: { id: 99 } } }],
    },
    workflow: { id: 7, name: 'CI', path: '.github/workflows/ci.yml' },
    jobs: [
      { name: 'changed path classifier', conclusion: 'success', run_attempt: 3 },
      { name: 'governance-service tests', conclusion: 'success', run_attempt: 3 },
    ],
    artifacts: [{
      id: 501, name: `verification-plan-${subjectSha}-attempt-3`, size_in_bytes: 100, expired: false,
      workflow_run: { id: 42, head_sha: subjectSha },
    }],
    livePull: { number: 8, state: 'open', body: 'bounded body', head: { sha: subjectSha }, base: { sha: baseSha, ref: 'main', repo: { id: 99 } } },
    associatedPulls: [{ number: 8, state: 'open', head: { sha: subjectSha }, base: { ref: 'main', repo: { id: 99 } } }],
    expectedRunAttempt: 3,
  };
}

test('workflow-run observation is reduced to bounded commit-bound metadata', () => {
  const result = buildWorkflowRunObservation(fixture());
  assert.equal(result.repository_id, 99);
  assert.equal(result.source_workflow_id, 7);
  assert.equal(result.source_run_attempt, 3);
  assert.equal(result.subject_sha, subjectSha);
  assert.match(result.body_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.artifacts[0].id, 501);
  assert.equal(result.artifacts[0].source_run_attempt, 3);
  assert.deepEqual(Object.keys(result.jobs[0]).sort(), ['conclusion', 'name']);
});

test('stale head, wrong workflow, cross-attempt job, and cross-run artifact fail closed', () => {
  for (const mutate of [
    (value) => { value.livePull.head.sha = '3'.repeat(40); },
    (value) => { value.workflow.path = '.github/workflows/other.yml'; },
    (value) => { value.jobs[0].run_attempt = 2; },
    (value) => { value.artifacts[0].workflow_run.id = 41; },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => buildWorkflowRunObservation(value));
  }
});

test('push runs and unsafe API names cannot become merge evidence', () => {
  const push = fixture();
  push.run.event = 'push';
  assert.throws(() => buildWorkflowRunObservation(push));
  const unsafe = fixture();
  unsafe.jobs[0].name = 'changed path classifier\nforged';
  assert.throws(() => buildWorkflowRunObservation(unsafe));
});

test('wrong base identity, stale event attempt, and unsafe artifact inventory fail closed', () => {
  for (const mutate of [
    (value) => { value.livePull.base.ref = 'release'; },
    (value) => { value.livePull.base.repo.id = 100; },
    (value) => { value.expectedRunAttempt = 2; },
    (value) => { value.artifacts[0].name = `unexpected-${subjectSha}-attempt-3`; },
    (value) => { value.artifacts[0].size_in_bytes = 2 * 1024 * 1024 + 1; },
    (value) => { value.artifacts.push({ ...value.artifacts[0] }); },
    (value) => { value.livePull.body = 'x'.repeat(256 * 1024 + 1); },
    (value) => { value.associatedPulls.push({ ...value.associatedPulls[0], number: 9 }); },
    (value) => { value.associatedPulls = Array.from({ length: 100 }, (_, index) => ({ ...value.associatedPulls[0], number: index + 1, state: 'closed' })); },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => buildWorkflowRunObservation(value));
  }
});

test('only artifacts from the current CI rerun are admitted to merge evidence', () => {
  const value = fixture();
  value.artifacts.unshift({
    ...value.artifacts[0], id: 500, name: `verification-plan-${subjectSha}-attempt-2`,
  });
  const artifacts = filterArtifactsForAttempt(value.artifacts, subjectSha, 3);
  assert.equal(artifacts.length, 1);
  assert.equal(buildWorkflowRunObservation({ ...value, artifacts }).artifacts[0].id, 501);

  value.artifacts.push({
    ...value.artifacts[0], id: 502, name: `unexpected-${subjectSha}-attempt-3`,
  });
  assert.throws(() => buildWorkflowRunObservation({
    ...value, artifacts: filterArtifactsForAttempt(value.artifacts, subjectSha, 3),
  }));
});

test('publisher freshness helper rejects an old attempt and a cross-PR run', () => {
  const current = fixture().run;
  const expected = { sourceRunId: 42, sourceRunAttempt: 3, pullRequestNumber: 8, subjectSha };
  assert.equal(isCurrentSourceRun({ ...expected, run: current }), true);
  const rerun = structuredClone(current);
  rerun.run_attempt = 4;
  assert.equal(isCurrentSourceRun({ ...expected, run: rerun }), false);
  const crossPr = structuredClone(current);
  crossPr.pull_requests[0].number = 9;
  assert.equal(isCurrentSourceRun({ ...expected, run: crossPr }), false);
  const failed = structuredClone(current);
  failed.conclusion = 'failure';
  assert.equal(isCurrentSourceRun({ ...expected, run: failed }), false);
});
