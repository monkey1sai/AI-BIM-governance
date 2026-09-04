#!/usr/bin/env node
// Compare a local verification-outcome/v1 with the check runs GitHub recorded for the same head.
//
// Read-only: one `gh api` GET. Writes an advisory_only ci-local-parity/v1 record under
// artifacts/metrics/ci-local-parity/. Never a gate input.
//
// Usage:
//   node scripts/dev/collect-ci-local-parity.mjs --repo owner/name --outcome <verification-outcome.json> --plan <verification-plan.json> [--out <path>]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareParity } from '../lib/ci-local-parity.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function assertContained(absolute, name) {
  const relativePath = relative(repoRoot, absolute);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error(`--${name} must resolve inside the repository`);
  return absolute;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--repo') options.repo = value;
    else if (flag === '--outcome') options.outcome = value;
    else if (flag === '--plan') options.plan = value;
    else if (flag === '--out') options.out = value;
    else throw new Error(`unknown argument ${flag}`);
    index += 1;
  }
  if (!REPOSITORY.test(options.repo ?? '')) throw new Error('--repo must be owner/name');
  if (!options.outcome || !options.plan) throw new Error('--outcome and --plan are required');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const outcome = JSON.parse(readFileSync(assertContained(resolve(process.cwd(), options.outcome), 'outcome'), 'utf8'));
const plan = JSON.parse(readFileSync(assertContained(resolve(process.cwd(), options.plan), 'plan'), 'utf8'));
if (!/^[0-9a-f]{40}$/u.test(outcome.subject_sha ?? '')) throw new Error('outcome.subject_sha must be a lowercase full commit id');
const payload = JSON.parse(execFileSync('gh', ['api', `repos/${options.repo}/commits/${outcome.subject_sha}/check-runs?per_page=100`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }));
const checkRuns = (payload.check_runs ?? []).map((run) => ({ name: run.name, conclusion: run.conclusion, head_sha: run.head_sha, app_id: run.app?.id ?? null }));
const record = compareParity({ outcome, plan, checkRuns });
const outPath = assertContained(resolve(repoRoot, options.out ?? `artifacts/metrics/ci-local-parity/${outcome.subject_sha}.json`), 'out');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`[parity] ${relative(repoRoot, outPath)} head=${record.head_sha} ${JSON.stringify(record.summary)} disqualifying=${record.disqualifying}\n`);
process.exit(record.disqualifying ? 1 : 0);
