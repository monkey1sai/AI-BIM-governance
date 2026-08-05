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
  changedPathsSince,
  createRawObservationBudget,
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

test('CLI rejects more than the bounded number of unique lifecycle row subjects before Git fan-out', () => {
  const fixture = makeRepository();
  try {
    const ledgerPath = path.join(fixture.root, 'openspec/lifecycle-ledger.json');
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    ledger.changes = Array.from({ length: 65 }, (_, index) => ({
      ...structuredClone(ledger.changes[0]),
      id: `change-${index}`,
      subject_commit: `${'a'.repeat(38)}${index.toString(16).padStart(2, '0')}`,
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
  for (const code of ['subject_not_head', 'subject_not_ancestor', 'subject_unavailable']) {
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

test('repeated row subject reuses actual Git ancestor and diff caches without consuming raw budget twice', () => {
  const fixture = makeRepository();
  try {
    write(path.join(fixture.root, 'unrelated/changed.json'), '{}\n');
    runGit(fixture.root, ['add', '--all']);
    runGit(fixture.root, ['commit', '--quiet', '-m', 'unrelated change']);
    const subjects = new Map();
    assert.equal(resolveRowSubjectWatermark(fixture.root, { subject_commit: fixture.subject, id: 'alpha' }, subjects), fixture.subject);
    assert.equal(resolveRowSubjectWatermark(fixture.root, { subject_commit: fixture.subject, id: 'alpha' }, subjects), fixture.subject);
    assert.equal(subjects.size, 1);
    const cache = new Map();
    const budget = createRawObservationBudget();
    const first = changedPathsSince(fixture.root, fixture.subject, cache, budget);
    const afterFirst = structuredClone(budget);
    const second = changedPathsSince(fixture.root, fixture.subject, cache, budget);
    assert.deepEqual(second, first);
    assert.deepEqual(budget, afterFirst);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
