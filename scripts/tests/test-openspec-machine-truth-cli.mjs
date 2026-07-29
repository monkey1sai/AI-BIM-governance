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

function runVerifier(root, subject) {
  const result = spawnSync(process.execPath, [
    commandPath,
    '--repo-root', root,
    '--ledger', 'openspec/lifecycle-ledger.json',
    '--now', 'docs/plans/NOW.md',
    '--github-state', 'artifacts/github.json',
    '--openspec-list', 'artifacts/openspec-list.json',
    '--subject', subject,
  ], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  assert.equal(result.stderr, '', 'verifier keeps stderr empty and emits one JSON envelope');
  return { status: result.status, document: JSON.parse(result.stdout) };
}

function makeRepository() {
  const trustRoot = process.env.AI_BIM_TEST_TRUST_ROOT || path.dirname(process.cwd());
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
