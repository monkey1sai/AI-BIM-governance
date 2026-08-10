// scripts/tests/test-openspec-repository-lifecycle.mjs
// Fixtures for the repository-scoped lifecycle parity gate. Every mismatch code is proven
// to fire on a tree that carries the drift, every malformed input is proven to fail closed
// rather than silently comparing a subset, and every state an author can legitimately
// write is proven to produce a targeted mismatch instead of taking the whole gate down.
// The final test points the comparator at the real repository, which is the assertion the
// gate exists for.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RepositoryLifecycleInputError,
  collectRepositoryObservation,
  compareRepositoryLifecycle,
  evaluateRepositoryLifecycle,
  parseLifecycleLedger,
  parseNowProjection,
  proposalLifecycleStatus,
} from '../lib/openspec-repository-lifecycle.mjs';
import {
  EXIT_INPUT_ERROR,
  EXIT_MISMATCH,
  EXIT_PARITY,
  main,
  parseArguments,
  renderError,
  renderMismatchLine,
} from './verify-openspec-repository-lifecycle.mjs';

const NOW_START = '<!-- lifecycle-ledger:start -->';
const NOW_END = '<!-- lifecycle-ledger:end -->';
const BOM = '﻿';
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';
const COMMAND_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify-openspec-repository-lifecycle.mjs');

function write(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

// Windows can briefly hold a handle on a just-written fixture tree; retry rather than
// leaving temp directories behind.
function removeTree(target) {
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function ledgerRow(id, status) {
  return { id, status, owner: 'repository-maintainer', current_slice: null, blocked_by: [] };
}

function nowDocument(rows) {
  return {
    schema_version: 'openspec-now-view/v1',
    scope: 'current',
    changes: rows.map(({ id, status }) => ({ id, status })),
  };
}

function nowMarkdown(document) {
  return [
    '# NOW',
    '',
    NOW_START,
    '```json',
    JSON.stringify(document, null, 2),
    '```',
    NOW_END,
    '',
  ].join('\n');
}

function proposal(status) {
  if (status === null) return '# Proposal\n\nNo lifecycle marker means active.\n';
  return `# Proposal\n\n> **Status: ${status}** — fixture.\n`;
}

function captureStreams() {
  const out = [];
  const err = [];
  return {
    out: { write: (value) => out.push(value) },
    err: { write: (value) => err.push(value) },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

/**
 * Materialises a minimal but structurally faithful repository: two current changes (one
 * active with no marker, one deferred with a marker) and one archived change.
 *
 * `spec.changes[id]` accepts a marker status, `null` for "no marker", `'no-proposal'` for a
 * directory without proposal.md, `'as-file'` for a plain file where a directory belongs,
 * or literal multi-line prose to write verbatim into proposal.md.
 */
function withRepository(run, mutate = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'openspec-repo-lifecycle-'));
  try {
    const spec = {
      ledger: {
        schema_version: 'openspec-lifecycle-ledger/v1',
        changes: [ledgerRow('alpha', 'active'), ledgerRow('beta', 'deferred'), ledgerRow('gamma', 'archived')],
      },
      now: nowDocument([{ id: 'alpha', status: 'active' }, { id: 'beta', status: 'deferred' }]),
      changes: { alpha: null, beta: 'deferred' },
      archive: { '2026-01-02-gamma': null },
      archiveFiles: [],
    };
    mutate(spec);

    write(path.join(root, 'openspec', 'lifecycle-ledger.json'),
      typeof spec.ledger === 'string' ? spec.ledger : JSON.stringify(spec.ledger, null, 2));
    write(path.join(root, 'docs', 'plans', 'NOW.md'),
      typeof spec.now === 'string' ? spec.now : nowMarkdown(spec.now));
    mkdirSync(path.join(root, 'openspec', 'changes', 'archive'), { recursive: true });
    for (const [id, status] of Object.entries(spec.changes)) {
      if (status === 'as-file') {
        write(path.join(root, 'openspec', 'changes', id), 'not a change directory\n');
        continue;
      }
      if (status === 'proposal-as-directory') {
        mkdirSync(path.join(root, 'openspec', 'changes', id, 'proposal.md'), { recursive: true });
        continue;
      }
      if (status === 'no-proposal') {
        mkdirSync(path.join(root, 'openspec', 'changes', id), { recursive: true });
        continue;
      }
      write(path.join(root, 'openspec', 'changes', id, 'proposal.md'),
        typeof status === 'string' && status.includes('\n') ? status : proposal(status));
    }
    for (const [directory, status] of Object.entries(spec.archive)) {
      write(path.join(root, 'openspec', 'changes', 'archive', directory, 'proposal.md'), proposal(status));
    }
    for (const name of spec.archiveFiles) {
      write(path.join(root, 'openspec', 'changes', 'archive', name), 'not an archive directory\n');
    }
    return run(root);
  } finally {
    removeTree(root);
  }
}

function expectInputError(root, code) {
  assert.throws(() => evaluateRepositoryLifecycle(root), (error) =>
    error instanceof RepositoryLifecycleInputError && error.code === code);
}

function findCode(root, code) {
  return evaluateRepositoryLifecycle(root).mismatches.find((item) => item.code === code);
}

function tryLink(target, link, context) {
  try {
    symlinkSync(target, link, LINK_TYPE);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') {
      context.skip('junction creation is unavailable');
      return false;
    }
    throw error;
  }
}

test('a consistent fixture repository reports no mismatch', () => {
  withRepository((root) => {
    const report = evaluateRepositoryLifecycle(root);
    assert.equal(report.schema_version, 'openspec-repository-lifecycle-report/v1');
    assert.deepEqual(report.mismatches, []);
    assert.equal(report.mismatch_count, 0);
    assert.equal(report.current_ledger_rows, 2);
    assert.equal(report.archived_ledger_rows, 1);
    assert.equal(report.now_rows, 2);
    assert.equal(report.change_directories, 2);
    assert.equal(report.archive_directories, 1);
  });
});

test('the full lifecycle vocabulary round-trips instead of failing the whole gate', () => {
  // `held` and `completed` are part of the ledger vocabulary in openspec-machine-truth.mjs;
  // a comparator that rejected either would take down the required check for a legal row.
  withRepository((root) => {
    assert.equal(evaluateRepositoryLifecycle(root).mismatch_count, 0);
  }, (spec) => {
    spec.ledger.changes.push(ledgerRow('delta', 'held'), ledgerRow('epsilon', 'completed'));
    spec.now.changes.push({ id: 'delta', status: 'held' }, { id: 'epsilon', status: 'completed' });
    spec.changes.delta = 'held';
    spec.changes.epsilon = 'adopted';
  });

  withRepository((root) => {
    const found = findCode(root, 'now_lifecycle_disagreement');
    assert.equal(found?.change_id, 'delta');
    assert.equal(found?.expected, 'held');
    assert.equal(found?.actual, 'deferred');
  }, (spec) => {
    spec.ledger.changes.push(ledgerRow('delta', 'held'));
    spec.now.changes.push({ id: 'delta', status: 'deferred' });
    spec.changes.delta = 'held';
  });

  // An `archived` spelling inside the current-scope projection is drift to report, not an
  // input the gate is unable to read.
  withRepository((root) => {
    const found = findCode(root, 'now_unexpected_change');
    assert.equal(found?.change_id, 'gamma');
    assert.equal(found?.actual, 'archived');
  }, (spec) => {
    spec.now.changes.push({ id: 'gamma', status: 'archived' });
  });
});

test('NOW projecting an archived change is refused', () => {
  withRepository((root) => {
    const found = findCode(root, 'now_unexpected_change');
    assert.equal(found?.change_id, 'gamma');
    assert.equal(found?.expected, 'absent');
    assert.equal(found?.actual, 'active');
  }, (spec) => {
    spec.now.changes.push({ id: 'gamma', status: 'active' });
  });
});

test('NOW omitting a current ledger row is refused', () => {
  withRepository((root) => {
    const found = findCode(root, 'now_change_missing');
    assert.equal(found?.change_id, 'beta');
    assert.equal(found?.actual, 'absent');
  }, (spec) => {
    spec.now.changes = spec.now.changes.filter(({ id }) => id !== 'beta');
  });
});

test('NOW disagreeing with the ledger status is refused', () => {
  withRepository((root) => {
    const found = findCode(root, 'now_lifecycle_disagreement');
    assert.equal(found?.change_id, 'beta');
    assert.equal(found?.expected, 'deferred');
    assert.equal(found?.actual, 'active');
  }, (spec) => {
    spec.now.changes = spec.now.changes.map((row) => (row.id === 'beta' ? { id: 'beta', status: 'active' } : row));
  });
});

test('a current ledger row without a change directory is refused', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'ledger_current_without_directory')?.change_id, 'beta');
  }, (spec) => {
    delete spec.changes.beta;
  });
});

test('a change directory without a current ledger row is refused', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'directory_without_ledger_row')?.change_id, 'delta');
  }, (spec) => {
    spec.changes.delta = null;
  });
});

test('an archived change that still has a live directory is named as such', () => {
  withRepository((root) => {
    const found = findCode(root, 'duplicate_active_archive');
    assert.equal(found?.change_id, 'gamma');
    assert.equal(found?.expected, 'archived');
    // The generic code must not be used for this case: it would misattribute the cause.
    assert.equal(findCode(root, 'directory_without_ledger_row'), undefined);
  }, (spec) => {
    spec.changes.gamma = null;
  });
});

test('a non-canonical change directory name is reported instead of being ignored', () => {
  withRepository((root) => {
    const found = findCode(root, 'change_directory_malformed');
    assert.equal(found?.actual, 'Delta_Change');
    assert.equal(found?.change_id, null);
  }, (spec) => {
    spec.changes.Delta_Change = null;
  });
});

test('a plain file standing in for a change directory cannot hide from the comparison', () => {
  // Dirent.isDirectory() is false for a plain file AND for a symlink to a directory, and
  // on Windows git checks a symlink out as a plain file. Filtering non-directories out
  // would let an undeclared change vanish from the gate entirely.
  withRepository((root) => {
    const found = findCode(root, 'change_entry_not_a_directory');
    assert.equal(found?.actual, 'ghost-change');
    assert.equal(findCode(root, 'directory_without_ledger_row'), undefined);
  }, (spec) => {
    spec.changes['ghost-change'] = 'as-file';
  });

  withRepository((root) => {
    assert.equal(findCode(root, 'archive_entry_not_a_directory')?.actual, '2026-09-09-ghost');
  }, (spec) => {
    spec.archiveFiles.push('2026-09-09-ghost');
  });
});

test('a linked entry inside a lifecycle namespace is refused outright', (context) => {
  withRepository((root) => {
    const link = path.join(root, 'openspec', 'changes', 'linked-change');
    if (!tryLink(path.join(root, 'openspec', 'changes', 'alpha'), link, context)) return;
    expectInputError(root, 'reparse_path');
  });
});

test('a linked lifecycle root is refused', (context) => {
  withRepository((root) => {
    const original = path.join(root, 'openspec', 'changes', 'archive');
    const target = path.join(root, 'linked-archive-target');
    renameSync(original, target);
    if (!tryLink(target, original, context)) return;
    expectInputError(root, 'reparse_path');
  });
});

test('a linked ancestor of a lifecycle input is refused, not only the leaf', (context) => {
  withRepository((root) => {
    const original = path.join(root, 'docs', 'plans');
    const target = path.join(root, 'real-plans');
    renameSync(original, target);
    if (!tryLink(target, original, context)) return;
    expectInputError(root, 'reparse_path');
  });
});

test('a repository legitimately reached through a link is still evaluated', (context) => {
  // The redirect defence protects paths BELOW the root. Refusing a checkout that is itself
  // reached through a junction would reject this repository's own worktree layout and turn
  // the required check red for a tree with no drift at all.
  const linkRoot = mkdtempSync(path.join(tmpdir(), 'openspec-repo-lifecycle-rootlink-'));
  try {
    withRepository((root) => {
      const link = path.join(linkRoot, 'checkout');
      if (!tryLink(root, link, context)) return;
      const report = evaluateRepositoryLifecycle(link);
      assert.equal(report.mismatch_count, 0);
      assert.equal(report.current_ledger_rows, 2);
      const spawned = spawnSync(process.execPath, [COMMAND_PATH, '--repo-root', link], { encoding: 'utf8' });
      assert.equal(spawned.status, EXIT_PARITY, spawned.stderr);
      rmSync(link, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    });
  } finally {
    removeTree(linkRoot);
  }
});

test('an archived ledger row without a dated archive directory is refused', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'ledger_archived_without_archive_directory')?.change_id, 'gamma');
  }, (spec) => {
    spec.archive = {};
  });
});

test('an archive directory without an archived ledger row is refused', () => {
  withRepository((root) => {
    const found = findCode(root, 'archive_directory_without_ledger_row');
    assert.equal(found?.change_id, 'epsilon');
    assert.equal(found?.actual, '2026-03-04-epsilon');
  }, (spec) => {
    spec.archive['2026-03-04-epsilon'] = null;
  });
});

test('two dated archive directories for one change id are refused', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'archive_directory_duplicate')?.change_id, 'gamma');
  }, (spec) => {
    spec.archive['2026-05-06-gamma'] = null;
  });
});

test('undated and impossible-dated archive directories are reported as malformed', () => {
  for (const name of ['gamma', '2026-13-45-delta', '2026-02-30-delta']) {
    withRepository((root) => {
      assert.equal(findCode(root, 'archive_directory_malformed')?.actual, name);
    }, (spec) => {
      spec.archive[name] = null;
    });
  }
});

test('a current change directory without proposal.md is refused', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'proposal_missing')?.change_id, 'beta');
  }, (spec) => {
    spec.changes.beta = 'no-proposal';
  });
});

test('a linked proposal.md is one mismatch, not a dead gate', (context) => {
  withRepository((root) => {
    const proposalPath = path.join(root, 'openspec', 'changes', 'beta', 'proposal.md');
    const target = path.join(root, 'real-beta-proposal.md');
    renameSync(proposalPath, target);
    try {
      symlinkSync(target, proposalPath, 'file');
    } catch (error) {
      if (error.code === 'EPERM') {
        context.skip('symlink creation is unavailable');
        return;
      }
      throw error;
    }
    const report = evaluateRepositoryLifecycle(root);
    assert.equal(report.mismatches.find((item) => item.code === 'proposal_unreadable')?.change_id, 'beta');
    assert.equal(report.mismatch_count, 1, 'the other rows must still be compared');
  });
});

test('a proposal marker disagreeing with the ledger is refused', () => {
  withRepository((root) => {
    const found = findCode(root, 'proposal_status_disagreement');
    assert.equal(found?.change_id, 'beta');
    assert.equal(found?.expected, 'deferred');
    assert.equal(found?.actual, 'active');
  }, (spec) => {
    spec.changes.beta = null;
  });
});

test('a near-miss status marker is reported instead of silently reading as active', () => {
  // `> **Status:** deferred` puts the colon outside the bold run, so the canonical parse
  // finds no marker. Defaulting to active would agree with an active ledger row for
  // entirely the wrong reason.
  for (const prologue of [
    '# Proposal\n\n> **Status:** deferred\n',
    '# Proposal\n\n> **Status : deferred**\n',
    '   > **Status: deferred**\n\nbody\n',
  ]) {
    withRepository((root) => {
      assert.equal(findCode(root, 'proposal_marker_unreadable')?.change_id, 'alpha',
        `near-miss marker not reported for: ${JSON.stringify(prologue)}`);
    }, (spec) => {
      spec.changes.alpha = prologue;
    });
  }

  // Ordinary blockquote prose must not trip the detector: this repository writes such
  // lines in real proposals, and a flaky gate would be worse than no gate.
  for (const prologue of [
    '# Proposal\n\n> Status quo is unacceptable.\n',
    '# Proposal\n\n> **Implementation status (2026-05-21)** — partial.\n',
    '# Proposal\n\nThe status of this work is unchanged.\n',
  ]) {
    withRepository((root) => {
      assert.equal(evaluateRepositoryLifecycle(root).mismatch_count, 0,
        `false positive for: ${JSON.stringify(prologue)}`);
    }, (spec) => {
      spec.changes.alpha = prologue;
    });
  }
});

test('a duplicated or unknown marker is named as an invalid marker', () => {
  withRepository((root) => {
    assert.equal(findCode(root, 'proposal_marker_invalid')?.change_id, 'alpha');
    assert.equal(findCode(root, 'proposal_status_disagreement'), undefined);
  }, (spec) => {
    spec.changes.alpha = '# Proposal\n\n> **Status: active**\n> **Status: deferred**\n';
  });

  withRepository((root) => {
    assert.equal(findCode(root, 'proposal_marker_invalid')?.change_id, 'alpha');
  }, (spec) => {
    spec.changes.alpha = '# Proposal\n\n> **Status: closeout**\n';
  });
});

test('proposal marker parsing mirrors the canonical semantics', () => {
  assert.equal(proposalLifecycleStatus('> **Status: active**\n> **Status: deferred**\n'), 'invalid');
  assert.equal(proposalLifecycleStatus('# Proposal\n\nno marker\n'), 'active');
  assert.equal(proposalLifecycleStatus('> **Status: adopted**\n'), 'completed');
  assert.equal(proposalLifecycleStatus('> **Status: held**\n'), 'held');
  assert.equal(proposalLifecycleStatus('> **Status: archived**\n'), 'archived');
  assert.equal(proposalLifecycleStatus('> **Status: bogus**\n'), 'invalid');
  assert.equal(proposalLifecycleStatus('> **Status:** deferred\n'), 'near-miss');
  assert.equal(proposalLifecycleStatus('> Status quo\n'), 'active');
  // A marker below the prologue window is not authority and must not be picked up.
  assert.equal(proposalLifecycleStatus(`${'filler\n'.repeat(45)}> **Status: deferred**\n`), 'active');
});

test('independent mismatches are all reported and ordered deterministically', () => {
  withRepository((root) => {
    const first = evaluateRepositoryLifecycle(root).mismatches;
    const second = evaluateRepositoryLifecycle(root).mismatches;
    assert.deepEqual(first, second);
    assert.deepEqual(first.map(({ code }) => code), [
      'archive_directory_without_ledger_row',
      'directory_without_ledger_row',
      'now_change_missing',
    ]);
  }, (spec) => {
    spec.now.changes = spec.now.changes.filter(({ id }) => id !== 'beta');
    spec.archive['2026-03-04-epsilon'] = null;
    spec.changes.delta = null;
  });
});

test('a malformed ledger fails closed instead of comparing a subset', () => {
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => { spec.ledger = '{ not json'; });
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => { spec.ledger.schema_version = 'other/v9'; });
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => { spec.ledger.changes = {}; });
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => { spec.ledger.changes[0].status = 'retired'; });
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => { spec.ledger.changes[0].id = 'Alpha_Change'; });
  withRepository((root) => expectInputError(root, 'ledger_invalid'), (spec) => {
    spec.ledger.changes.push(ledgerRow('alpha', 'deferred'));
  });
});

test('a malformed NOW projection fails closed instead of comparing a subset', () => {
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => { spec.now = '# NOW\n\nno block\n'; });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${nowMarkdown(nowDocument([]))}\n${nowMarkdown(nowDocument([]))}`;
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${NOW_START}\n{ "schema_version": "openspec-now-view/v1" }\n${NOW_END}\n`;
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${NOW_START}\n\`\`\`json\n{ not json\n\`\`\`\n${NOW_END}\n`;
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${NOW_START}\n\`\`\`jsonc\n{}\n\`\`\`\n${NOW_END}\n`;
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    const document = nowDocument([{ id: 'alpha', status: 'active' }]);
    document.scope = 'all';
    spec.now = document;
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now.changes.push({ id: 'alpha', status: 'active' });
  });
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now.changes[0].status = 'retired';
  });
});

test('an inverted NOW marker pair is refused', () => {
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${NOW_END}\n\`\`\`json\n{}\n\`\`\`\n${NOW_START}\n`;
  });
});

test('an unterminated fence fails fast instead of backtracking', { timeout: 20_000 }, () => {
  // A regex of the form /^```json\s*([\s\S]*?)\s*```$/ degrades super-linearly on this
  // input and would let any pull request burn the required check's entire job budget.
  withRepository((root) => expectInputError(root, 'now_invalid'), (spec) => {
    spec.now = `${NOW_START}\n\`\`\`json${' '.repeat(200_000)}X\n${NOW_END}\n`;
  });
});

test('a UTF-8 BOM does not hide the NOW projection block', () => {
  withRepository((root) => {
    assert.equal(evaluateRepositoryLifecycle(root).mismatch_count, 0);
  }, (spec) => {
    spec.now = BOM + nowMarkdown(spec.now);
  });
});

test('missing lifecycle inputs are refused rather than treated as empty', () => {
  withRepository((root) => {
    rmSync(path.join(root, 'docs', 'plans', 'NOW.md'));
    expectInputError(root, 'unreadable_path');
  });
  withRepository((root) => {
    rmSync(path.join(root, 'openspec', 'lifecycle-ledger.json'));
    expectInputError(root, 'unreadable_path');
  });
  withRepository((root) => {
    removeTree(path.join(root, 'openspec', 'changes', 'archive'));
    expectInputError(root, 'unreadable_path');
  });
  expectInputError(path.join(tmpdir(), 'openspec-repo-lifecycle-absent-root'), 'unreadable_path');
});

test('the comparator refuses an observation that is missing a source', () => {
  withRepository((root) => {
    const observation = collectRepositoryObservation(root);
    assert.throws(() => compareRepositoryLifecycle({ ...observation, ledger: {} }), RepositoryLifecycleInputError);
    assert.throws(() => compareRepositoryLifecycle({ ...observation, changeEntries: null }), RepositoryLifecycleInputError);
    assert.throws(() => compareRepositoryLifecycle(null), RepositoryLifecycleInputError);
  });
});

test('the parsers accept only their declared shapes', () => {
  assert.throws(() => parseLifecycleLedger('[]'), RepositoryLifecycleInputError);
  assert.throws(() => parseNowProjection('nothing here'), RepositoryLifecycleInputError);
  const ledger = parseLifecycleLedger(JSON.stringify({
    schema_version: 'openspec-lifecycle-ledger/v1',
    changes: [ledgerRow('alpha', 'active')],
  }));
  assert.deepEqual([...ledger], [['alpha', 'active']]);
  const now = parseNowProjection(nowMarkdown(nowDocument([{ id: 'alpha', status: 'active' }])));
  assert.deepEqual([...now], [['alpha', 'active']]);
});

test('the command reports parity, mismatch, and input errors with distinct exit codes', () => {
  withRepository((root) => {
    const sink = captureStreams();
    assert.equal(main(['--repo-root', root], sink), EXIT_PARITY);
    assert.match(sink.stdout(), /openspec repository lifecycle OK/u);
  });

  withRepository((root) => {
    const sink = captureStreams();
    assert.equal(main(['--repo-root', root, '--format', 'json'], sink), EXIT_MISMATCH);
    const report = JSON.parse(sink.stdout());
    assert.equal(report.mismatch_count, 1);
    assert.equal(report.mismatches[0].code, 'now_change_missing');
  }, (spec) => {
    spec.now.changes = spec.now.changes.filter(({ id }) => id !== 'beta');
  });

  withRepository((root) => {
    const sink = captureStreams();
    assert.equal(main(['--repo-root', root, '--format', 'json'], sink), EXIT_INPUT_ERROR);
    assert.equal(JSON.parse(sink.stderr()).code, 'ledger_invalid');
    assert.equal(sink.stdout(), '');
  }, (spec) => { spec.ledger = '{ not json'; });

  const sink = captureStreams();
  assert.equal(main(['--unknown', 'value'], sink), EXIT_INPUT_ERROR);
  assert.equal(main(['--format'], sink), EXIT_INPUT_ERROR);
  assert.equal(main(['--format', 'yaml'], sink), EXIT_INPUT_ERROR);
  // The requested format has to survive an argument error too.
  const jsonSink = captureStreams();
  assert.equal(main(['--unknown', 'value', '--format', 'json'], jsonSink), EXIT_INPUT_ERROR);
  assert.equal(JSON.parse(jsonSink.stderr()).code, 'invalid_argument');
  assert.throws(() => parseArguments(['--repo-root', 'a', '--repo-root', 'b']), RepositoryLifecycleInputError);
});

test('the command actually runs when spawned as a process, including through a link', (context) => {
  const run = (commandPath, root) => spawnSync(process.execPath, [commandPath, '--repo-root', root], { encoding: 'utf8' });

  withRepository((root) => {
    const direct = run(COMMAND_PATH, root);
    assert.equal(direct.status, EXIT_PARITY, direct.stderr);
    assert.match(direct.stdout, /openspec repository lifecycle OK/u);
  });

  withRepository((root) => {
    const drifted = run(COMMAND_PATH, root);
    assert.equal(drifted.status, EXIT_MISMATCH);
    assert.match(drifted.stdout, /MISMATCH now_change_missing/u);
  }, (spec) => {
    spec.now.changes = spec.now.changes.filter(({ id }) => id !== 'beta');
  });

  // Node resolves import.meta.url through links but not process.argv[1]; a naive string
  // comparison would make the command a silent no-op under exactly this layout, which is
  // how this repository's worktrees are arranged.
  const linkRoot = mkdtempSync(path.join(tmpdir(), 'openspec-repo-lifecycle-link-'));
  try {
    const linkedTests = path.join(linkRoot, 'tests');
    if (!tryLink(path.dirname(COMMAND_PATH), linkedTests, context)) return;
    withRepository((root) => {
      const linked = run(path.join(linkedTests, 'verify-openspec-repository-lifecycle.mjs'), root);
      assert.equal(linked.status, EXIT_PARITY, linked.stderr);
      assert.match(linked.stdout, /openspec repository lifecycle OK/u,
        'the command must produce a report when reached through a link, not exit 0 silently');
    });
  } finally {
    removeTree(linkRoot);
  }
});

test('a directory standing in for proposal.md is one mismatch, not a dead gate', () => {
  // Portable companion to the symlink fixture: a symlink satisfies the first predicate and
  // short-circuits, so only this case exercises the non-regular-file predicate.
  withRepository((root) => {
    const report = evaluateRepositoryLifecycle(root);
    assert.equal(report.mismatches.find((item) => item.code === 'proposal_unreadable')?.change_id, 'beta');
    assert.equal(report.mismatch_count, 1, 'the other rows must still be compared');
  }, (spec) => {
    spec.changes.beta = 'proposal-as-directory';
  });
});

test('bounded input budgets are enforced as input_too_large', () => {
  const bulk = (count, statusOf = () => 'active') => {
    const ids = Array.from({ length: count }, (unused, index) => `bulk-${String(index).padStart(4, '0')}`);
    return ids.map((id) => ({ id, status: statusOf(id) }));
  };

  // The accepted boundary: MAX_CURRENT_CHANGES current directories plus the mandatory
  // `archive` namespace must still be evaluated, not refused one change short of the limit.
  const atLimit = bulk(512);
  withRepository((root) => {
    assert.equal(evaluateRepositoryLifecycle(root).mismatch_count, 0);
  }, (spec) => {
    spec.ledger.changes = [ledgerRow('gamma', 'archived'), ...atLimit.map(({ id }) => ledgerRow(id, 'active'))];
    spec.now = nowDocument(atLimit);
    spec.changes = Object.fromEntries(atLimit.map(({ id }) => [id, null]));
  });

  // One past it.
  const overLimit = bulk(513);
  withRepository((root) => expectInputError(root, 'input_too_large'), (spec) => {
    spec.ledger.changes = [ledgerRow('gamma', 'archived'), ...overLimit.map(({ id }) => ledgerRow(id, 'active'))];
    spec.now = nowDocument(overLimit.slice(0, 512));
    spec.changes = Object.fromEntries(overLimit.map(({ id }) => [id, null]));
  });

  withRepository((root) => expectInputError(root, 'input_too_large'), (spec) => {
    spec.now = nowDocument(bulk(513));
  });

  withRepository((root) => expectInputError(root, 'input_too_large'), (spec) => {
    spec.ledger.changes = bulk(8193).map(({ id }) => ledgerRow(id, 'archived'));
  });

  withRepository((root) => expectInputError(root, 'input_too_large'), (spec) => {
    spec.now = `${nowMarkdown(spec.now)}\n${'x'.repeat(4 * 1024 * 1024)}\n`;
  });
});

test('control characters in a path-derived value cannot forge report lines', () => {
  const escaped = renderMismatchLine({
    code: 'change_entry_not_a_directory',
    change_id: null,
    expected_source: 'openspec_changes_contract',
    expected: 'directory',
    actual_source: 'openspec_changes',
    actual: 'ghost\nopenspec repository lifecycle OK: all three sources agree.',
    message: 'forged',
  });
  assert.equal(escaped.split('\n').length, 1, 'a newline in a path-derived value must not open a second line');
  assert.match(escaped, /ghost\\n/u);
});

test('a status token that does not end at a canonical delimiter is not read as that status', () => {
  // `^>\s*\*\*Status:\s*([a-z-]+)` with no trailing boundary captures `active` out of
  // `active123`, so a malformed marker would agree with an active ledger row.
  assert.equal(proposalLifecycleStatus('> **Status: active123**\n'), 'near-miss');
  assert.equal(proposalLifecycleStatus('> **Status: deferred_foo**\n'), 'near-miss');
  assert.equal(proposalLifecycleStatus('> **Status: deferred 2026-07-29**\n'), 'deferred');

  withRepository((root) => {
    assert.equal(findCode(root, 'proposal_marker_unreadable')?.change_id, 'alpha');
  }, (spec) => {
    spec.changes.alpha = '# Proposal\n\n> **Status: active123**\n';
  });
});

test('a near-miss marker beside a canonical marker is not ignored', () => {
  // Near-miss detection used to run only when no canonical marker was found, so a proposal
  // carrying two disagreeing declarations resolved silently to the canonical one.
  assert.equal(proposalLifecycleStatus('> **Status: active**\n> **Status:** deferred\n'), 'near-miss');
  assert.equal(proposalLifecycleStatus('> **Status: active**\n> **Status : deferred**\n'), 'near-miss');
  assert.equal(proposalLifecycleStatus('> **Status: active**\n> **Status: deferred**\n'), 'invalid');

  withRepository((root) => {
    assert.equal(findCode(root, 'proposal_marker_unreadable')?.change_id, 'alpha');
  }, (spec) => {
    spec.changes.alpha = '# Proposal\n\n> **Status: active**\n> **Status:** deferred\n';
  });
});

test('one malformed entry beside a full change set is still a targeted mismatch', () => {
  // The raw namespace budget is deliberately larger than the canonical change budget so a
  // stray file does not collapse into a generic budget error at the boundary.
  const ids = Array.from({ length: 512 }, (unused, index) => `bulk-${String(index).padStart(4, '0')}`);
  withRepository((root) => {
    const report = evaluateRepositoryLifecycle(root);
    assert.equal(report.mismatches.length, 1);
    assert.equal(report.mismatches[0].code, 'change_entry_not_a_directory');
    assert.equal(report.mismatches[0].actual, 'stray-entry');
  }, (spec) => {
    spec.ledger.changes = [ledgerRow('gamma', 'archived'), ...ids.map((id) => ledgerRow(id, 'active'))];
    spec.now = nowDocument(ids.map((id) => ({ id, status: 'active' })));
    spec.changes = Object.fromEntries([...ids.map((id) => [id, null]), ['stray-entry', 'as-file']]);
  });
});

test('control characters in a path-derived input error cannot forge report lines', () => {
  const forged = new RepositoryLifecycleInputError(
    'reparse_path',
    'openspec/changes/ghost\nopenspec repository lifecycle OK: all three sources agree.',
    'Lifecycle directory entry must not be a link: ghost\nforged');
  const text = renderError(forged, 'text');
  assert.equal(text.split('\n').length, 1, 'a newline in a path-derived field must not open a second line');
  assert.match(text, /ghost\\n/u);
  // JSON output stays machine-parseable and unescaped by this path.
  assert.equal(JSON.parse(renderError(forged, 'json')).field, forged.field);
});

test('the real repository lifecycle sources agree', () => {
  const report = evaluateRepositoryLifecycle(process.cwd());
  assert.deepEqual(report.mismatches, [],
    'openspec/changes, the lifecycle ledger, and the NOW projection must agree');
  assert.ok(report.current_ledger_rows > 0, 'the gate must observe real current rows, not an empty ledger');
  assert.ok(report.archived_ledger_rows > 0, 'the gate must observe real archived rows, not an empty archive');
  assert.equal(report.now_rows, report.current_ledger_rows);
  assert.equal(report.change_directories, report.current_ledger_rows);
});
