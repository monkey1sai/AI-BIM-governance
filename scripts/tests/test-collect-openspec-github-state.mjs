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

test('subject mismatch and unbounded pull observations fail closed', () => {
  assert.throws(() => buildGitHubLifecycleObservation({ ledger, repository: 'example/repository', repositoryInfo, pulls: [], subject: 'f'.repeat(40) }));
  assert.throws(() => buildGitHubLifecycleObservation({ ledger, repository: 'example/repository', repositoryInfo, pulls: Array(1001).fill({}), subject }));
});
