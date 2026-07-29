import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { compareBaseline, normalizeEslintResults, resolveSourceRoot } from './check-eslint-baseline.mjs';

const root = process.cwd();
const sample = [{ filePath: `${root}/src/example.tsx`, messages: [{ ruleId: 'rule-a', severity: 1, message: 'redacted by hash' }] }];

test('shrink-only ESLint baseline accepts the same or fewer findings', () => {
  const findings = normalizeEslintResults(sample, root);
  const baseline = { findings };
  assert.equal(compareBaseline(baseline, findings).passed, true);
  assert.equal(compareBaseline(baseline, []).passed, true);
});

test('shrink-only ESLint baseline rejects a new finding without exposing its message', () => {
  const findings = normalizeEslintResults(sample, root);
  const result = compareBaseline({ findings: [] }, findings);
  assert.equal(result.passed, false);
  assert.equal(result.regression_fingerprints, 1);
  assert.equal(JSON.stringify(result).includes('redacted by hash'), false);
});

test('trusted baseline rejects candidate inflation and duplicate fingerprints', () => {
  const findings = normalizeEslintResults(sample, root);
  const inflated = structuredClone(findings);
  inflated[0].count += 1;
  assert.equal(compareBaseline({ findings }, inflated).passed, false);
  assert.throws(() => compareBaseline({ findings: [...findings, ...findings] }, findings));
});

test('source-root option accepts one path and rejects ambiguous input', () => {
  assert.equal(resolveSourceRoot([], root), root);
  assert.equal(resolveSourceRoot(['--source-root', 'fixture'], root), path.resolve('fixture'));
  assert.throws(() => resolveSourceRoot(['--source-root']));
  assert.throws(() => resolveSourceRoot(['--source-root', 'a', '--source-root', 'b']));
  assert.throws(() => resolveSourceRoot(['--source-root', '--unsafe']));
});
