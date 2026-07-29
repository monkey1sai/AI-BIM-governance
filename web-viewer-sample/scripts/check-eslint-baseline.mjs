#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(root, 'scripts', 'eslint-baseline.json');

function findingKey(finding) {
  return [finding.path, finding.rule_id, finding.severity, finding.message_sha256].join('\0');
}

export function normalizeEslintResults(results, repositoryRoot = root) {
  const counts = new Map();
  for (const result of results) {
    const relative = path.relative(repositoryRoot, result.filePath).replaceAll('\\', '/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('ESLint result escaped the viewer root.');
    for (const message of result.messages) {
      const finding = {
        path: relative,
        rule_id: message.ruleId ?? 'eslint-parser',
        severity: message.severity === 2 ? 'error' : 'warning',
        message_sha256: createHash('sha256').update(String(message.message)).digest('hex'),
      };
      const key = findingKey(finding);
      const prior = counts.get(key);
      counts.set(key, prior ? { ...prior, count: prior.count + 1 } : { ...finding, count: 1 });
    }
  }
  return [...counts.values()].sort((left, right) => findingKey(left).localeCompare(findingKey(right), 'en'));
}

export function compareBaseline(baseline, current) {
  const allowed = new Map();
  for (const item of baseline.findings) {
    const key = findingKey(item);
    if (allowed.has(key)) throw new Error('ESLint baseline contains a duplicate fingerprint.');
    allowed.set(key, item.count);
  }
  const currentKeys = new Set();
  for (const item of current) {
    const key = findingKey(item);
    if (currentKeys.has(key)) throw new Error('Current ESLint findings contain a duplicate fingerprint.');
    currentKeys.add(key);
  }
  const regressions = current.filter((item) => item.count > (allowed.get(findingKey(item)) ?? 0));
  return {
    baseline_count: baseline.findings.reduce((sum, item) => sum + item.count, 0),
    current_count: current.reduce((sum, item) => sum + item.count, 0),
    regression_fingerprints: regressions.length,
    passed: regressions.length === 0,
  };
}

function loadBaseline(filePath = baselinePath) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 1024 * 1024) throw new Error('ESLint baseline must be a bounded regular file.');
  const baseline = JSON.parse(readFileSync(filePath, 'utf8'));
  if (baseline.schema_version !== 'eslint-baseline/v1' || baseline.policy !== 'shrink-only' ||
      !Array.isArray(baseline.findings) || JSON.stringify(Object.keys(baseline).sort()) !== JSON.stringify(['findings', 'policy', 'schema_version'])) {
    throw new Error('ESLint baseline contract is invalid.');
  }
  for (const item of baseline.findings) {
    if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(['count', 'message_sha256', 'path', 'rule_id', 'severity']) ||
        typeof item.path !== 'string' || item.path.includes('..') || !/^[0-9a-f]{64}$/u.test(item.message_sha256) ||
        !['error', 'warning'].includes(item.severity) || !Number.isInteger(item.count) || item.count < 1) {
      throw new Error('ESLint baseline finding is invalid.');
    }
  }
  compareBaseline({ findings: baseline.findings }, baseline.findings);
  return baseline;
}

function collect() {
  const eslintCli = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const result = spawnSync(process.execPath, [eslintCli, '.', '--ext', 'ts,tsx', '--report-unused-disable-directives',
    '--format', 'json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('ESLint could not produce a bounded JSON report.');
  return normalizeEslintResults(JSON.parse(result.stdout));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const findings = collect();
    if (process.argv.includes('--print-baseline')) {
      process.stdout.write(`${JSON.stringify({ schema_version: 'eslint-baseline/v1', policy: 'shrink-only', findings }, null, 2)}\n`);
    } else {
      const trustedIndex = process.argv.indexOf('--trusted-baseline');
      if (trustedIndex >= 0 && (trustedIndex !== process.argv.length - 2 || process.argv[trustedIndex + 1].startsWith('--'))) {
        throw new Error('--trusted-baseline requires exactly one path.');
      }
      const candidate = loadBaseline();
      const trusted = trustedIndex < 0 ? candidate : loadBaseline(path.resolve(process.argv[trustedIndex + 1]));
      const candidatePolicy = compareBaseline(trusted, candidate.findings);
      const summary = compareBaseline(candidate, findings);
      process.stdout.write(`[eslint-baseline] trusted=${candidatePolicy.baseline_count} baseline=${summary.baseline_count} current=${summary.current_count} regressions=${summary.regression_fingerprints}\n`);
      process.exitCode = candidatePolicy.passed && summary.passed ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`[eslint-baseline] ${error instanceof Error ? error.message : 'failed safely'}\n`);
    process.exitCode = 2;
  }
}
