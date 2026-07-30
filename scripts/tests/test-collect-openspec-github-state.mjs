import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGitHubLifecycleObservation } from '../lib/collect-openspec-github-state.mjs';

const subject = 'a'.repeat(40);
const repositoryInfo = { id: 99, full_name: 'example/repository' };
const ledger = {
  schema_version: 'openspec-lifecycle-ledger/v1',
  changes: [
    { id: 'alpha-change', status: 'active', subject_commit: subject },
    { id: 'beta-change', status: 'deferred', subject_commit: subject },
    { id: 'completed-change', status: 'completed', subject_commit: subject },
    { id: 'held-change', status: 'held', subject_commit: subject },
    { id: 'old-change', status: 'archived', subject_commit: subject },
  ],
};

test('GitHub lifecycle observation uses only canonical same-repository OpenSpec branches', () => {
  const pulls = [
    { number: 7, state: 'open', merged_at: null, head: { ref: 'codex/openspec/alpha-change', sha: 'b'.repeat(40), repo: { id: 99 } } },
    { number: 8, state: 'closed', merged_at: '2026-01-01T00:00:00Z', head: { ref: 'codex/openspec/beta-change', sha: 'c'.repeat(40), repo: { id: 99 } } },
    { number: 9, state: 'open', merged_at: null, head: { ref: 'feature/alpha-change', sha: 'd'.repeat(40), repo: { id: 99 } } },
    { number: 10, state: 'open', merged_at: null, head: { ref: 'codex/openspec/alpha-change', sha: 'e'.repeat(40), repo: { id: 100 } } },
  ];
  const result = buildGitHubLifecycleObservation({ ledger, repository: 'example/repository', repositoryInfo, pulls, subject });
  assert.deepEqual(result.changes, [
    { id: 'alpha-change', prs: [{ number: 7, state: 'open', head_sha: 'b'.repeat(40) }] },
    { id: 'beta-change', prs: [{ number: 8, state: 'merged', head_sha: 'c'.repeat(40) }] },
    { id: 'completed-change', prs: [] },
    { id: 'held-change', prs: [] },
  ]);
});

test('malformed repository subject and unbounded pull observations fail closed', () => {
  assert.throws(() => buildGitHubLifecycleObservation({ ledger, repository: 'example/repository', repositoryInfo, pulls: [], subject: 'f'.repeat(39) }));
  assert.throws(() => buildGitHubLifecycleObservation({ ledger, repository: 'example/repository', repositoryInfo, pulls: Array(1001).fill({}), subject }));
});

test('repository subject remains the current head while current rows retain historical snapshots', () => {
  const historical = structuredClone(ledger);
  historical.changes[0].subject_commit = 'b'.repeat(40);
  historical.changes[1].subject_commit = 'c'.repeat(40);

  const result = buildGitHubLifecycleObservation({
    ledger: historical,
    repository: 'example/repository',
    repositoryInfo,
    pulls: [],
    subject,
  });

  assert.equal(result.repository_subject, subject);
  assert.deepEqual(result.changes.map(({ id }) => id), [
    'alpha-change', 'beta-change', 'completed-change', 'held-change',
  ]);
});

test('current row identity rejects duplicate ids and malformed historical subjects', () => {
  const duplicate = structuredClone(ledger);
  duplicate.changes[1].id = duplicate.changes[0].id;
  assert.throws(() => buildGitHubLifecycleObservation({
    ledger: duplicate, repository: 'example/repository', repositoryInfo, pulls: [], subject,
  }));

  const malformed = structuredClone(ledger);
  malformed.changes[0].subject_commit = 'B'.repeat(40);
  assert.throws(() => buildGitHubLifecycleObservation({
    ledger: malformed, repository: 'example/repository', repositoryInfo, pulls: [], subject,
  }));
});
