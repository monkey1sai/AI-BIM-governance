#!/usr/bin/env node
// Collect a read-only GitHub Actions cost baseline into artifacts/metrics/actions-baseline/.
//
// Read-only: only `gh api` GET calls. Never re-runs, cancels, comments, or changes settings.
// Output is measurement_only and gitignored; it is never a gate input.
//
// Usage:
//   node scripts/dev/collect-actions-baseline.mjs --repo owner/name [--runs 300] [--jobs-sample 40] [--out <path>]

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBaselineReport } from '../lib/actions-baseline.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function usage() {
  return `Usage:
  node scripts/dev/collect-actions-baseline.mjs --repo <owner/name> [--runs <n<=1000>] [--jobs-sample <n<=100>] [--out <path>]

Read-only. Emits a measurement_only actions-baseline/v1 report under artifacts/metrics/actions-baseline/.`;
}

function parseArgs(argv) {
  const options = { runs: 300, jobsSample: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--help' || flag === '-h') { process.stdout.write(`${usage()}\n`); process.exit(0); }
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--repo') options.repo = value;
    else if (flag === '--runs') options.runs = Number(value);
    else if (flag === '--jobs-sample') options.jobsSample = Number(value);
    else if (flag === '--out') options.out = value;
    else throw new Error(`unknown argument ${flag}`);
    index += 1;
  }
  if (!REPOSITORY.test(options.repo ?? '')) throw new Error('--repo must be owner/name');
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 1000) throw new Error('--runs must be 1..1000');
  if (!Number.isInteger(options.jobsSample) || options.jobsSample < 0 || options.jobsSample > 100) throw new Error('--jobs-sample must be 0..100');
  return options;
}

function ghJson(pathname) {
  const stdout = execFileSync('gh', ['api', pathname], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

function assertContained(absolute) {
  const relativePath = relative(repoRoot, absolute);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('--out must resolve inside the repository');
  return absolute;
}

const options = parseArgs(process.argv.slice(2));
const collectedAt = new Date().toISOString();
const runs = [];
for (let page = 1; runs.length < options.runs; page += 1) {
  const perPage = Math.min(100, options.runs - runs.length);
  const payload = ghJson(`repos/${options.repo}/actions/runs?per_page=${perPage}&page=${page}`);
  const batch = (payload.workflow_runs ?? []).map((run) => ({
    id: run.id, name: run.name, event: run.event, status: run.status, conclusion: run.conclusion,
    run_started_at: run.run_started_at, updated_at: run.updated_at, head_sha: run.head_sha,
  }));
  runs.push(...batch);
  if (batch.length < perPage) break;
}
const sampled = runs.filter((run) => run.status === 'completed' && run.event === 'pull_request').slice(0, options.jobsSample);
const jobs = [];
for (const run of sampled) {
  const payload = ghJson(`repos/${options.repo}/actions/runs/${run.id}/jobs?per_page=100`);
  for (const job of payload.jobs ?? []) {
    jobs.push({
      run_id: run.id, workflow_name: run.name, name: job.name, conclusion: job.conclusion,
      started_at: job.started_at, completed_at: job.completed_at,
      steps: (job.steps ?? []).map((step) => ({ name: step.name, conclusion: step.conclusion, started_at: step.started_at, completed_at: step.completed_at })),
    });
  }
}
const window = runs.length ? { oldest: runs.at(-1).run_started_at, newest: runs[0].run_started_at, runs: runs.length, job_runs_sampled: sampled.length } : null;
const report = buildBaselineReport({ repository: options.repo, collected_at: collectedAt, window, runs, jobs });
const outPath = assertContained(resolve(repoRoot, options.out ?? `artifacts/metrics/actions-baseline/${collectedAt.replace(/[:.]/gu, '-')}.json`));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`[baseline] ${relative(repoRoot, outPath)}\n`);
process.stdout.write(`[baseline] runs=${runs.length} job_runs=${sampled.length} runners/run=${report.totals.runners_per_run} runner-min/run=${report.totals.runner_minutes_per_run} skipped-step=${report.totals.skipped_step_ratio} setup-share=${report.totals.setup_share}\n`);
for (const workflow of report.workflows.slice(0, 8)) {
  process.stdout.write(`[baseline] ${workflow.workflow}: n=${workflow.runs} p50=${workflow.p50_seconds}s p95=${workflow.p95_seconds}s cancelled=${workflow.cancelled_ratio}\n`);
}
