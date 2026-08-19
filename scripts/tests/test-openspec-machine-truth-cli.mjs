import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertReconcileRatchet,
  changedPathsSince,
  collectSourceObservations,
  resolveRowSubjectWatermark,
} from './verify-openspec-machine-truth.mjs';

const commandPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-openspec-machine-truth.mjs');

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function runGit(root, args) {
  const safeRoot = root.replaceAll('\\', '/');
  const result = spawnSync('git', ['-c', `safe.directory=${safeRoot}`, '-C', root, ...args], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function snapshot(root) {
  const rows = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        rows.push(`${path.relative(root, fullPath).replaceAll('\\', '/')}:${createHash('sha256').update(readFileSync(fullPath)).digest('hex')}`);
      }
    }
  };
  visit(root);
  return rows.sort().join('\n');
}

function runVerifier(root, subject, base = subject) {
  const result = spawnSync(process.execPath, [
    commandPath,
    '--repo-root', root,
    '--ledger', 'openspec/lifecycle-ledger.json',
    '--now', 'docs/plans/NOW.md',
    '--github-state', 'artifacts/github.json',
    '--openspec-list', 'artifacts/openspec-list.json',
    '--subject', subject,
    '--base', base,
  ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(result.stderr, '', 'verifier keeps stderr empty and emits one JSON envelope');
  return { status: result.status, document: JSON.parse(result.stdout) };
}

test('CLI without arguments fails closed with one machine-readable envelope', () => {
  const result = spawnSync(process.execPath, [commandPath], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  assert.equal(result.status, 3);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout);
  assert.equal(document.result, 'input_error');
  assert.equal(document.errors[0].code, 'invalid_argument');
});

function makeRepository() {
  const trustRoot = process.env.AI_BIM_TEST_TRUST_ROOT || path.join(process.cwd(), 'artifacts', 'tmp', 'machine-truth-fixtures');
  mkdirSync(trustRoot, { recursive: true });
  const root = mkdtempSync(path.join(trustRoot, 'machine-truth-cli-'));
  write(path.join(root, 'openspec/changes/archive/.keep'), '');
  write(path.join(root, 'openspec/changes/alpha/proposal.md'), '# Alpha\n');
  write(path.join(root, 'openspec/changes/alpha/tasks.md'), '- [x] done\n- [ ] todo\n');
  runGit(root, ['init', '--quiet']);
  runGit(root, ['config', 'user.email', 'fixture@example.invalid']);
  runGit(root, ['config', 'user.name', 'Machine Truth Fixture']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  runGit(root, ['add', '--all']);
  runGit(root, ['commit', '--quiet', '-m', 'observed source']);
  const subject = runGit(root, ['rev-parse', 'HEAD']);
  const change = {
    id: 'alpha',
    status: 'active',
    owner: 'fixture-owner',
    current_slice: 'fixture slice',
    blocked_by: [],
    last_verified: '2026-07-28T00:00:00Z',
    task_ledger: { completed: 1, total: 2 },
    evidence_refs: ['openspec/changes/alpha/proposal.md', 'openspec/changes/alpha/tasks.md'],
    subject_commit: subject,
    archive_debt: null,
  };
  write(path.join(root, 'openspec/lifecycle-ledger.json'), `${JSON.stringify({
    schema_version: 'openspec-lifecycle-ledger/v1', changes: [change],
  })}\n`);
  write(path.join(root, 'docs/plans/NOW.md'), `<!-- lifecycle-ledger:start -->\n\`\`\`json\n${JSON.stringify({
    schema_version: 'openspec-now-view/v1', scope: 'current', changes: [{ id: 'alpha', status: 'active' }],
  })}\n\`\`\`\n<!-- lifecycle-ledger:end -->\n`);
  write(path.join(root, 'artifacts/github.json'), `${JSON.stringify({
    schema_version: 'openspec-github-lifecycle-state/v1',
    scope: 'current',
    repository_subject: subject,
    changes: [{ id: 'alpha', prs: [] }],
  })}\n`);
  write(path.join(root, 'artifacts/openspec-list.json'), `${JSON.stringify({
    changes: [{ name: 'alpha', status: 'in-progress', completedTasks: 1, totalTasks: 2 }],
  })}\n`);
  return { root, subject };
}

function commitLifecycleSnapshot(fixture) {
  runGit(fixture.root, ['add', '--all']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'record lifecycle snapshot']);
  return runGit(fixture.root, ['rev-parse', 'HEAD']);
}

function makeHistoricalRowRepository() {
  const fixture = makeRepository();
  write(path.join(fixture.root, 'openspec/changes/beta/proposal.md'), '# Beta\n');
  write(path.join(fixture.root, 'openspec/changes/beta/tasks.md'), '- [x] done\n- [ ] todo\n');
  runGit(fixture.root, ['add', 'openspec/changes/beta']);
  runGit(fixture.root, ['commit', '--quiet', '-m', 'add beta source']);
  const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
  const ledgerPath = path.join(fixture.root, 'openspec/lifecycle-ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.changes.push({
    ...structuredClone(ledger.changes[0]),
    id: 'beta',
    subject_commit: head,
    evidence_refs: ['openspec/changes/beta/proposal.md', 'openspec/changes/beta/tasks.md'],
  });
  write(ledgerPath, `${JSON.stringify(ledger)}\n`);
  write(path.join(fixture.root, 'docs/plans/NOW.md'), `<!-- lifecycle-ledger:start -->\n\`\`\`json\n${JSON.stringify({
    schema_version: 'openspec-now-view/v1', scope: 'current', changes: [
      { id: 'alpha', status: 'active' }, { id: 'beta', status: 'active' },
    ],
  })}\n\`\`\`\n<!-- lifecycle-ledger:end -->\n`);
  write(path.join(fixture.root, 'artifacts/github.json'), `${JSON.stringify({
    schema_version: 'openspec-github-lifecycle-state/v1', scope: 'current', repository_subject: head,
    changes: [{ id: 'alpha', prs: [] }, { id: 'beta', prs: [] }],
  })}\n`);
  write(path.join(fixture.root, 'artifacts/openspec-list.json'), `${JSON.stringify({
    changes: [
      { name: 'alpha', status: 'in-progress', completedTasks: 1, totalTasks: 2 },
      { name: 'beta', status: 'in-progress', completedTasks: 1, totalTasks: 2 },
    ],
  })}\n`);
  return { ...fixture, head, ledgerPath };
}

test('CLI enforces 0/2/3 outcomes, source binding and read-only behavior', () => {
  const fixture = makeRepository();
  try {
    let before = snapshot(fixture.root);
    const consistent = runVerifier(fixture.root, fixture.subject);
    assert.equal(consistent.status, 0);
    assert.equal(consistent.document.result, 'consistent');
    assert.equal(snapshot(fixture.root), before);

    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# Changed after subject\n');
    before = snapshot(fixture.root);
    const stale = runVerifier(fixture.root, fixture.subject);
    assert.equal(stale.status, 2);
    assert.equal(stale.document.result, 'mismatch');
    assert.ok(stale.document.mismatches.some(({ reason }) => reason === 'source_changed_since_subject'));
    assert.equal(snapshot(fixture.root), before);

    write(path.join(fixture.root, 'artifacts/github.json'), '{ invalid');
    before = snapshot(fixture.root);
    const malformed = runVerifier(fixture.root, fixture.subject);
    assert.equal(malformed.status, 3);
    assert.equal(malformed.document.result, 'input_error');
    assert.equal(malformed.document.errors[0].code, 'artifact_invalid_json');
    assert.equal(snapshot(fixture.root), before);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI rejects an existing historical commit as the trusted subject', () => {
  const fixture = makeRepository();
  try {
    runGit(fixture.root, ['commit', '--quiet', '--allow-empty', '-m', 'newer head']);
    const historical = runVerifier(fixture.root, fixture.subject);
    assert.equal(historical.status, 3);
    assert.equal(historical.document.result, 'input_error');
    assert.equal(historical.document.errors[0].code, 'subject_not_head');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI accepts ancestral heterogeneous row subjects and attributes later source drift to its row', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const accepted = runVerifier(fixture.root, fixture.head);
    assert.equal(accepted.status, 0);
    assert.equal(accepted.document.result, 'consistent');

    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# Changed alpha source\n');
    const drifted = runVerifier(fixture.root, fixture.head);
    assert.equal(drifted.status, 2);
    assert.ok(drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'source_changed_since_subject'));
    assert.ok(!drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'source_changed_since_subject'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI fails closed when a row subject is unavailable or not a HEAD ancestor', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const unavailable = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    unavailable.changes[0].subject_commit = 'f'.repeat(40);
    write(fixture.ledgerPath, `${JSON.stringify(unavailable)}\n`);
    const missing = runVerifier(fixture.root, fixture.head);
    assert.equal(missing.status, 3);
    assert.equal(missing.document.errors[0].code, 'subject_unavailable');

    const nonancestor = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    nonancestor.changes[0].subject_commit = runGit(fixture.root, ['commit-tree', 'HEAD^{tree}', '-m', 'orphan row snapshot']);
    write(fixture.ledgerPath, `${JSON.stringify(nonancestor)}\n`);
    const orphan = runVerifier(fixture.root, fixture.head);
    assert.equal(orphan.status, 3);
    assert.equal(orphan.document.errors[0].code, 'subject_not_ancestor');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI derives the squash-introduced watermark when a recorded row subject was discarded by a squash merge', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    // Squash shape: the row lands in history carrying a pre-merge subject SHA
    // that no longer exists as a commit. The commit that introduced the binding
    // is the correct staleness watermark.
    const squashed = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    squashed.changes[0].subject_commit = 'f'.repeat(40);
    write(fixture.ledgerPath, `${JSON.stringify(squashed)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'squash: land row with its discarded pre-merge subject']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);

    const accepted = runVerifier(fixture.root, head);
    assert.equal(accepted.status, 0);
    assert.equal(accepted.document.result, 'consistent');

    // Staleness detection must survive the derived watermark: a source edit
    // after the introduction commit still red-flags exactly that row.
    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# drift after squash\n');
    const drifted = runVerifier(fixture.root, head);
    assert.equal(drifted.status, 2);
    assert.ok(drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'source_changed_since_subject'));
    assert.ok(!drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'source_changed_since_subject'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI keeps a committed non-ancestor row subject fail-closed instead of recovering a watermark', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const orphan = runGit(fixture.root, ['commit-tree', 'HEAD^{tree}', '-m', 'orphan reachable object']);
    const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    ledger.changes[0].subject_commit = orphan;
    write(fixture.ledgerPath, `${JSON.stringify(ledger)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'land orphan-bound row']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(fixture.root, head);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'subject_not_ancestor');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI resolves a shared discarded subject per row and still flags the older row source drift', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const discarded = 'f'.repeat(40);
    const first = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    first.changes[0].subject_commit = discarded;
    write(fixture.ledgerPath, `${JSON.stringify(first)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'squash: land alpha binding']);

    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# alpha drifted between the two introductions\n');
    runGit(fixture.root, ['add', 'openspec/changes/alpha/proposal.md']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'alpha source edit after its binding landed']);

    const second = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    second.changes[1].subject_commit = discarded;
    write(fixture.ledgerPath, `${JSON.stringify(second)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'squash: land beta binding with the same discarded value']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);

    const result = runVerifier(fixture.root, head);
    assert.equal(result.status, 2);
    assert.ok(result.document.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'source_changed_since_subject'));
    assert.ok(!result.document.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'source_changed_since_subject'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI fails closed when the same discarded row binding was introduced more than once', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const discarded = 'f'.repeat(40);
    const reachable = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8')).changes[0].subject_commit;
    const bindAlphaTo = (value, message) => {
      const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
      ledger.changes[0].subject_commit = value;
      write(fixture.ledgerPath, `${JSON.stringify(ledger)}\n`);
      runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
      runGit(fixture.root, ['commit', '--quiet', '-m', message]);
    };
    bindAlphaTo(discarded, 'squash: first introduction');
    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# drift hidden by reintroduction\n');
    runGit(fixture.root, ['add', 'openspec/changes/alpha/proposal.md']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'alpha drifts between introductions']);
    bindAlphaTo(reachable, 'rebind away');
    bindAlphaTo(discarded, 'reintroduce the same discarded binding');
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(fixture.root, head);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'subject_unavailable');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI rejects a candidate-minted fake row binding: recovery only accepts introductions landed at the trusted base', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const base = commitLifecycleSnapshot(fixture);
    const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    ledger.changes[0].subject_commit = 'f'.repeat(40);
    write(fixture.ledgerPath, `${JSON.stringify(ledger)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'candidate mints a fake binding']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(fixture.root, head, base);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'subject_unavailable');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI compares against the explicit base and rejects a committed candidate that removes a lifecycle row and its sources', () => {
  const fixture = makeRepository();
  try {
    const base = commitLifecycleSnapshot(fixture);
    runGit(fixture.root, ['rm', '-r', 'openspec/changes/alpha']);
    write(path.join(fixture.root, 'openspec/lifecycle-ledger.json'), '{"schema_version":"openspec-lifecycle-ledger/v1","changes":[]}\n');
    write(path.join(fixture.root, 'docs/plans/NOW.md'), '<!-- lifecycle-ledger:start -->\n```json\n{"schema_version":"openspec-now-view/v1","scope":"current","changes":[]}\n```\n<!-- lifecycle-ledger:end -->\n');
    write(path.join(fixture.root, 'artifacts/github.json'), '{"schema_version":"openspec-github-lifecycle-state/v1","scope":"current","repository_subject":"PLACEHOLDER","changes":[]}\n');
    write(path.join(fixture.root, 'artifacts/openspec-list.json'), '{"changes":[]}\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'remove lifecycle row and source']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    write(path.join(fixture.root, 'artifacts/github.json'), `${JSON.stringify({
      schema_version: 'openspec-github-lifecycle-state/v1', scope: 'current', repository_subject: head, changes: [],
    })}\n`);
    const result = runVerifier(fixture.root, head, base);
    assert.equal(result.status, 2);
    assert.ok(result.document.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'change_removed'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('CLI rejects more than the bounded number of lifecycle rows before Git fan-out', () => {
  // Owner ruling 2026-08-18 (openQuestions #1): MAX_UNIQUE_SUBJECTS is aligned
  // to the 500-row ledger cap, so the pre-fan-out rejection now triggers at the
  // row cap itself. Sixty-five unique watermarks are accepted (covered by the
  // dedicated capacity test below); 501 rows stay fail-closed without fan-out.
  const fixture = makeRepository();
  try {
    const ledgerPath = path.join(fixture.root, 'openspec/lifecycle-ledger.json');
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    ledger.changes = Array.from({ length: 501 }, (_, index) => ({
      ...structuredClone(ledger.changes[0]),
      id: `change-${index}`,
      subject_commit: `${'a'.repeat(37)}${index.toString(16).padStart(3, '0')}`,
    }));
    write(ledgerPath, `${JSON.stringify(ledger)}\n`);
    const result = runVerifier(fixture.root, fixture.subject);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'source_observation_invalid');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('machine-truth report schema accepts every emitted subject failure code', () => {
  const schema = JSON.parse(readFileSync(path.join(path.dirname(commandPath), 'openspec-machine-truth-report.schema.json'), 'utf8'));
  const codes = schema.properties.errors.items.properties.code.enum;
  for (const code of ['subject_not_head', 'subject_not_ancestor', 'subject_unavailable', 'subject_binding_required']) {
    assert.ok(codes.includes(code), `schema must accept ${code}`);
  }
});

test('raw observation budget rejects unrelated decoded paths before row-subject fan-out', () => {
  const fixture = makeRepository();
  try {
    for (let index = 0; index <= 10_000; index += 1) {
      write(path.join(fixture.root, 'unrelated', `${index}.json`), '');
    }
    const result = runVerifier(fixture.root, fixture.subject);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'source_observation_invalid');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('repeated row subject reuses actual Git ancestor and diff caches; raw diff no longer consumes the budget', () => {
  const fixture = makeRepository();
  try {
    write(path.join(fixture.root, 'unrelated/changed.json'), '{}\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'unrelated change']);
    const subjects = new Map();
    assert.equal(resolveRowSubjectWatermark(fixture.root, { subject_commit: fixture.subject, id: 'alpha' }, subjects, fixture.subject), fixture.subject);
    assert.equal(resolveRowSubjectWatermark(fixture.root, { subject_commit: fixture.subject, id: 'alpha' }, subjects, fixture.subject), fixture.subject);
    assert.equal(subjects.size, 1);
    const cache = new Map();
    const first = changedPathsSince(fixture.root, fixture.subject, cache);
    const second = changedPathsSince(fixture.root, fixture.subject, cache);
    assert.deepEqual(second, first);
    assert.ok(first.includes('unrelated/changed.json'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('unrelated repo-wide churn between a watermark and HEAD does not consume the shared raw budget', () => {
  // Owner ruling 2026-08-18 (openQuestions #1): the budget is charged after the
  // owned-path filter, so a large refactor in an unrelated directory can no
  // longer exhaust the observation budget for every row.
  const fixture = makeRepository();
  try {
    for (let index = 0; index < 50; index += 1) {
      write(path.join(fixture.root, 'unrelated-service', `${index}.txt`), `${index}\n`);
    }
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'unrelated repo-wide churn']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const ledger = JSON.parse(readFileSync(path.join(fixture.root, 'openspec/lifecycle-ledger.json'), 'utf8'));
    const { sourceObservations } = collectSourceObservations(fixture.root, ledger, head);
    assert.ok(sourceObservations.every(({ changed_paths: paths }) => paths.every((value) => !value.startsWith('unrelated-service/'))));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('sentinel row resolves a squash-discarded subject to its introduction and keeps drift precision', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const squashed = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    squashed.changes[0].subject_commit = 'f'.repeat(40);
    squashed.changes[0].subject_binding = 'introduction';
    write(fixture.ledgerPath, `${JSON.stringify(squashed)}\n`);
    // Fold a source edit into the same squash unit: the deliberate residual
    // limit says it must NOT be red-flagged after the squash.
    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# folded into the same squash unit\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'squash: land sentinel row with discarded pre-merge subject']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);

    const accepted = runVerifier(fixture.root, head);
    assert.equal(accepted.status, 0, JSON.stringify(accepted.document.errors ?? accepted.document.mismatches));
    assert.equal(accepted.document.result, 'consistent');

    // Post-introduction edits still red-flag exactly the sentinel row.
    write(path.join(fixture.root, 'openspec/changes/alpha/proposal.md'), '# drift after the introduction\n');
    const drifted = runVerifier(fixture.root, head);
    assert.equal(drifted.status, 2);
    assert.ok(drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'alpha' && reason === 'source_changed_since_subject'));
    assert.ok(!drifted.document.mismatches.some(({ change_id: id, reason }) => id === 'beta' && reason === 'source_changed_since_subject'));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('sentinel row treats a locally surviving non-ancestor subject exactly like a missing one (determinism)', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    // An orphan commit object that exists locally but is outside HEAD history:
    // the legacy branch hard-fails subject_not_ancestor on this shape; the
    // sentinel declares the SHA a watermark key only and must resolve through
    // the introduction algorithm, matching a clean clone where the object is
    // gone entirely.
    const orphan = runGit(fixture.root, ['commit-tree', 'HEAD^{tree}', '-m', 'orphan pre-squash survivor']);
    const ledger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    ledger.changes[0].subject_commit = orphan;
    ledger.changes[0].subject_binding = 'introduction';
    write(fixture.ledgerPath, `${JSON.stringify(ledger)}\n`);
    runGit(fixture.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'squash: land sentinel row bound to a locally surviving orphan']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(fixture.root, head);
    assert.equal(result.status, 0, JSON.stringify(result.document.errors ?? result.document.mismatches));
    assert.equal(result.document.result, 'consistent');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('sentinel resolution keeps every introduction failure fail-closed: ambiguity and minted bindings', () => {
  // Rebind-away-and-back ambiguity stays HELD for sentinel rows.
  const ambiguous = makeHistoricalRowRepository();
  try {
    const discarded = 'f'.repeat(40);
    const reachable = JSON.parse(readFileSync(ambiguous.ledgerPath, 'utf8')).changes[0].subject_commit;
    const bindAlphaTo = (value, sentinel, message) => {
      const ledger = JSON.parse(readFileSync(ambiguous.ledgerPath, 'utf8'));
      ledger.changes[0].subject_commit = value;
      if (sentinel) ledger.changes[0].subject_binding = 'introduction';
      else delete ledger.changes[0].subject_binding;
      write(ambiguous.ledgerPath, `${JSON.stringify(ledger)}\n`);
      runGit(ambiguous.root, ['add', 'openspec/lifecycle-ledger.json']);
      runGit(ambiguous.root, ['commit', '--quiet', '-m', message]);
    };
    bindAlphaTo(discarded, true, 'squash: first sentinel introduction');
    bindAlphaTo(reachable, false, 'rebind away');
    bindAlphaTo(discarded, true, 'reintroduce the same sentinel binding');
    const head = runGit(ambiguous.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(ambiguous.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(ambiguous.root, head);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'subject_unavailable');
  } finally {
    rmSync(ambiguous.root, { recursive: true, force: true });
  }
  // A candidate-minted sentinel binding is rejected by trusted-base ancestry.
  const minted = makeHistoricalRowRepository();
  try {
    const base = commitLifecycleSnapshot(minted);
    const ledger = JSON.parse(readFileSync(minted.ledgerPath, 'utf8'));
    ledger.changes[0].subject_commit = 'f'.repeat(40);
    ledger.changes[0].subject_binding = 'introduction';
    write(minted.ledgerPath, `${JSON.stringify(ledger)}\n`);
    runGit(minted.root, ['add', 'openspec/lifecycle-ledger.json']);
    runGit(minted.root, ['commit', '--quiet', '-m', 'candidate mints a sentinel binding']);
    const head = runGit(minted.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(minted.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    const result = runVerifier(minted.root, head, base);
    assert.equal(result.status, 3);
    assert.equal(result.document.errors[0].code, 'subject_unavailable');
  } finally {
    rmSync(minted.root, { recursive: true, force: true });
  }
});

test('assertGitBase anchors --base to origin/main ancestry when that ref exists', () => {
  const fixture = makeRepository();
  try {
    const base = fixture.subject;
    write(path.join(fixture.root, 'unrelated/next.txt'), 'next\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'work beyond origin/main']);
    const head = runGit(fixture.root, ['rev-parse', 'HEAD']);
    const githubPath = path.join(fixture.root, 'artifacts/github.json');
    const githubState = JSON.parse(readFileSync(githubPath, 'utf8'));
    githubState.repository_subject = head;
    write(githubPath, `${JSON.stringify(githubState)}\n`);
    // Pin origin/main at the base commit: --base beyond it must be refused
    // (self-blessing guard, challenge B5); --base at it must pass the anchor.
    runGit(fixture.root, ['update-ref', 'refs/remotes/origin/main', base]);
    const refused = runVerifier(fixture.root, head, head);
    assert.equal(refused.status, 3);
    assert.equal(refused.document.errors[0].code, 'base_unavailable');
    const anchored = runVerifier(fixture.root, head, base);
    assert.notEqual(anchored.status, 3, JSON.stringify(anchored.document.errors ?? []));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('reconcile ratchet blocks undeclared danglable bindings and admits exact P2b normalization', () => {
  const fixture = makeHistoricalRowRepository();
  try {
    const base = commitLifecycleSnapshot(fixture);
    const baseLedger = JSON.parse(readFileSync(fixture.ledgerPath, 'utf8'));
    write(path.join(fixture.root, 'scratch.txt'), 'branch work\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'branch head beyond base']);
    const branchHead = runGit(fixture.root, ['rev-parse', 'HEAD']);

    const row = (id, subject, sentinel = false) => ({
      id, subject_commit: subject, ...(sentinel ? { subject_binding: 'introduction' } : {}),
    });
    const ledgerWith = (...changes) => ({ schema_version: 'openspec-lifecycle-ledger/v1', changes });
    const alphaBefore = baseLedger.changes[0];

    // New row bound to the branch head without the sentinel: blocked.
    assert.throws(
      () => assertReconcileRatchet(fixture.root, ledgerWith(row('gamma', branchHead)), baseLedger, base),
      (error) => error.code === 'subject_binding_required');
    // New row with the sentinel, or bound to a base ancestor: admitted.
    assertReconcileRatchet(fixture.root, ledgerWith(row('gamma', branchHead, true)), baseLedger, base);
    assertReconcileRatchet(fixture.root, ledgerWith(row('gamma', base)), baseLedger, base);
    // Untouched row: exempt.
    assertReconcileRatchet(fixture.root, ledgerWith(row('alpha', alphaBefore.subject_commit)), baseLedger, base);
    // Rewritten row to the branch head without the sentinel: blocked (legacy rebind-to-PR-HEAD).
    assert.throws(
      () => assertReconcileRatchet(fixture.root, ledgerWith(row('alpha', branchHead)), baseLedger, base),
      (error) => error.code === 'subject_binding_required');
    // Rewritten row with the sentinel: admitted.
    assertReconcileRatchet(fixture.root, ledgerWith(row('alpha', branchHead, true)), baseLedger, base);
    // Exact P2b normalization: the base binding resolves to itself here, so the
    // only admissible undeclared rewrite target is that resolved value - any
    // other base ancestor is watermark laundering and stays blocked.
    assertReconcileRatchet(fixture.root, ledgerWith(row('alpha', alphaBefore.subject_commit)), baseLedger, base);
    const otherAncestor = runGit(fixture.root, ['rev-parse', `${base}^`]);
    assert.throws(
      () => assertReconcileRatchet(fixture.root, ledgerWith(row('alpha', otherAncestor)), baseLedger, base),
      (error) => error.code === 'subject_binding_required');
    // Bootstrap-era: no previous ledger, ratchet does not apply.
    assertReconcileRatchet(fixture.root, ledgerWith(row('gamma', branchHead)), null, base);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('more than 64 unique row watermarks no longer trip the unique-subject budget', () => {
  const fixture = makeRepository();
  try {
    const subjects = [fixture.subject];
    for (let index = 0; index < 69; index += 1) {
      write(path.join(fixture.root, 'churn.txt'), `${index}\n`);
      runGit(fixture.root, ['add', 'churn.txt']);
      runGit(fixture.root, ['commit', '--quiet', '-m', `churn ${index}`]);
      subjects.push(runGit(fixture.root, ['rev-parse', 'HEAD']));
    }
    const head = subjects[subjects.length - 1];
    const ledger = {
      schema_version: 'openspec-lifecycle-ledger/v1',
      changes: subjects.map((subject, index) => ({
        id: `row-${index}`,
        subject_commit: subject,
        evidence_refs: [],
      })),
    };
    const { sourceObservations } = collectSourceObservations(fixture.root, ledger, head);
    assert.equal(sourceObservations.length, subjects.length);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
