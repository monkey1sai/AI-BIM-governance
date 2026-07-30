// JS half of the two-implementation task-checkbox parity contract.
// The PowerShell half lives in scripts/tests/test-openspec-ledger-reconciliation.ps1 and asserts
// the SAME corpus against Measure-OpenSpecTaskCheckboxes. Both halves must pass for the two
// parsers to be considered in agreement; neither half alone proves parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { taskLedgerFromText } from '../lib/openspec-machine-truth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.join(here, 'fixtures', 'task-ledger-parity.json');
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));

test('parity corpus is present and non-trivial', () => {
  assert.equal(corpus.schema_version, 'task-ledger-parity/v1');
  assert.ok(Array.isArray(corpus.cases), 'cases must be an array');
  // Vacuity guard: an empty or truncated corpus would make every other assertion below
  // pass without checking anything. Keep this floor above the current case count minus a
  // small margin so accidental deletion fails loudly rather than silently going green.
  assert.ok(
    corpus.cases.length >= 20,
    `corpus must retain at least 20 cases (found ${corpus.cases.length})`,
  );
  const ids = corpus.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'case ids must be unique');
  for (const c of corpus.cases) {
    assert.equal(typeof c.text, 'string', `${c.id}: text must be a string`);
    assert.ok(c.why && c.why.length > 0, `${c.id}: why must explain the case`);
    for (const k of ['completed', 'total', 'unsupported']) {
      assert.ok(Number.isInteger(c.expected?.[k]), `${c.id}: expected.${k} must be an integer`);
    }
  }
});

test('regression guards for the four closed divergences are retained', () => {
  const required = [
    'regression-nested-after-empty-checked',
    'regression-nested-after-trailing-space-open',
    'regression-no-space-after-bracket',
    'regression-multichar-mark',
    'tilde-stays-unsupported',
    'after-zero-width-and-invisible-is-unsupported',
    'after-nel-is-unsupported-not-whitespace',
    'after-paren-lookalikes-are-unsupported',
    'after-unicode-whitespace-still-counts',
    'mark-typo-is-unsupported',
  ];
  const ids = new Set(corpus.cases.map((c) => c.id));
  for (const id of required) {
    assert.ok(ids.has(id), `corpus must keep regression case '${id}'`);
  }
});

for (const c of corpus.cases) {
  test(`taskLedgerFromText matches corpus: ${c.id}`, () => {
    const actual = taskLedgerFromText(c.text);
    assert.deepEqual(
      {
        completed: actual.completed,
        total: actual.total,
        unsupported: actual.unsupported,
      },
      {
        completed: c.expected.completed,
        total: c.expected.total,
        unsupported: c.expected.unsupported,
      },
      `${c.id}: ${c.why}`,
    );
    // Unchecked is always derived, never counted independently.
    assert.equal(
      actual.total - actual.completed,
      c.expected.total - c.expected.completed,
      `${c.id}: derived unchecked must match`,
    );
  });
}

test('counts never go negative and total bounds completed', () => {
  for (const c of corpus.cases) {
    const r = taskLedgerFromText(c.text);
    assert.ok(r.completed >= 0 && r.total >= 0 && r.unsupported >= 0, `${c.id}: no negative counts`);
    assert.ok(r.completed <= r.total, `${c.id}: completed must not exceed total`);
  }
});

test('parser is line-order independent for shuffled independent lines', () => {
  // Property check: the parser is per-line and stateless, so shuffling whole lines must not
  // change any count. This is what makes the cross-line greedy-whitespace bug impossible to
  // reintroduce — that bug made the result depend on which line followed which.
  const lines = [
    '- [x] a',
    '- [ ] b',
    '- [~] c',
    '  - [x] nested',
    '- [WIP] prose',
    '- [x](https://example.com)',
    '- [x]done',
    '',
    '# heading',
  ];
  const baseline = taskLedgerFromText(lines.join('\n'));
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const shuffled = [...lines];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.deepEqual(
      taskLedgerFromText(shuffled.join('\n')),
      baseline,
      `line order must not change counts (iteration ${iteration})`,
    );
  }
});
