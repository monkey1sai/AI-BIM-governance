import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ActionsBaselineError,
  assertMeasurementOnly,
  buildBaselineReport,
  percentile,
  summarizeJobs,
  summarizeWorkflowRuns,
} from '../lib/actions-baseline.mjs';

const T = (offsetSeconds) => new Date(Date.UTC(2026, 8, 4, 0, 0, offsetSeconds)).toISOString();

const runs = [
  { id: 1, name: 'CI', event: 'pull_request', status: 'completed', conclusion: 'success', run_started_at: T(0), updated_at: T(100) },
  { id: 2, name: 'CI', event: 'pull_request', status: 'completed', conclusion: 'success', run_started_at: T(0), updated_at: T(300) },
  { id: 3, name: 'CI', event: 'pull_request', status: 'completed', conclusion: 'cancelled', run_started_at: T(0), updated_at: T(20) },
  { id: 4, name: 'Agent Governance', event: 'pull_request', status: 'completed', conclusion: 'success', run_started_at: T(0), updated_at: T(250) },
  { id: 5, name: 'Claude Code', event: 'issue_comment', status: 'completed', conclusion: 'skipped', run_started_at: T(0), updated_at: T(1) },
];

const jobs = [
  {
    run_id: 1, workflow_name: 'CI', name: 'changed path classifier', conclusion: 'success', started_at: T(0), completed_at: T(13),
    steps: [
      { name: 'Set up job', conclusion: 'success', started_at: T(0), completed_at: T(2) },
      { name: 'Checkout', conclusion: 'success', started_at: T(2), completed_at: T(6) },
      { name: 'Classify changed paths', conclusion: 'success', started_at: T(6), completed_at: T(12) },
      { name: 'Complete job', conclusion: 'success', started_at: T(12), completed_at: T(13) },
    ],
  },
  { run_id: 1, workflow_name: 'CI', name: 'coordinator build and tests', conclusion: 'skipped', started_at: null, completed_at: null, steps: [] },
  {
    run_id: 4, workflow_name: 'Agent Governance', name: 'agent-governance suite (capability)', conclusion: 'success', started_at: T(0), completed_at: T(100),
    steps: [
      { name: 'Set up job', conclusion: 'success', started_at: T(0), completed_at: T(5) },
      { name: 'Checkout', conclusion: 'success', started_at: T(5), completed_at: T(15) },
      { name: 'Run A', conclusion: 'skipped', started_at: T(15), completed_at: T(15) },
      { name: 'Run B', conclusion: 'skipped', started_at: T(15), completed_at: T(15) },
      { name: 'Run C', conclusion: 'skipped', started_at: T(15), completed_at: T(15) },
      { name: 'Run capability', conclusion: 'success', started_at: T(15), completed_at: T(99) },
    ],
  },
];

test('paginating a non-multiple run count keeps per_page constant and truncates locally', () => {
  // A shrinking per_page makes `page=2` re-fetch the tail of page 1, so the collector must hold
  // per_page at 100 and slice the final batch. This models that contract over the same arithmetic.
  const PAGE_SIZE = 100;
  const requested = 150;
  const server = Array.from({ length: 400 }, (unused, index) => index + 1);
  const collected = [];
  for (let page = 1; collected.length < requested; page += 1) {
    const batch = server.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    collected.push(...batch.slice(0, requested - collected.length));
    if (batch.length < PAGE_SIZE) break;
  }
  assert.equal(collected.length, requested);
  assert.equal(new Set(collected).size, requested, 'no duplicates');
  assert.deepEqual(collected.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(collected.slice(-3), [148, 149, 150], 'items 101-150 are fetched, not 51-100 again');
});

test('percentile is ceil-rank and null on empty input', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5, 1, 3], 50), 3);
  assert.equal(percentile([5, 1, 3], 95), 5);
});

test('workflow summary reports p50/p95, cancellation ratio and conclusions per workflow', () => {
  const summary = summarizeWorkflowRuns(runs);
  const ci = summary.find((entry) => entry.workflow === 'CI');
  assert.equal(ci.runs, 3);
  assert.equal(ci.completed, 3);
  assert.equal(ci.p50_seconds, 100);
  assert.equal(ci.p95_seconds, 300);
  assert.equal(ci.cancelled_ratio, 0.333);
  assert.deepEqual(ci.conclusions, { success: 2, cancelled: 1 });
  const claude = summary.find((entry) => entry.workflow === 'Claude Code');
  assert.deepEqual(claude.conclusions, { skipped: 1 });
});

test('job summary counts runners only for jobs that actually ran and measures skipped steps and setup share', () => {
  const summary = summarizeJobs(jobs);
  assert.equal(summary.totals.runners_started, 2, 'a skipped job with no steps starts no runner');
  assert.equal(summary.totals.runs_sampled, 2);
  assert.equal(summary.totals.runners_per_run, 1);
  assert.equal(summary.totals.steps_total, 10);
  assert.equal(summary.totals.steps_skipped, 3);
  assert.equal(summary.totals.skipped_step_ratio, 0.3);
  assert.equal(summary.totals.runner_seconds, 113);
  assert.equal(summary.totals.setup_seconds, 22);
  assert.equal(summary.totals.setup_share, 0.195);
  const capability = summary.jobs.find((entry) => entry.job === 'agent-governance suite (capability)');
  assert.equal(capability.skipped_step_ratio, 0.5);
  const coordinator = summary.jobs.find((entry) => entry.job === 'coordinator build and tests');
  assert.equal(coordinator.seen, 1);
  assert.equal(coordinator.ran, 0);
});

test('the report is measurement_only and retains no bodies, logs, actors or urls', () => {
  const report = buildBaselineReport({ repository: 'monkey1sai/AI-BIM-governance', collected_at: T(0), window: null, runs, jobs });
  assert.equal(report.schema_version, 'actions-baseline/v1');
  assert.equal(report.authority, 'measurement_only');
  assert.deepEqual(report.privacy.excluded, ['bodies', 'logs', 'actors', 'urls']);
  assert.equal(assertMeasurementOnly(report), report);
  assert.throws(() => assertMeasurementOnly({ ...report, authority: 'gate' }), (error) => error instanceof ActionsBaselineError && error.code === 'authority_invalid');
  assert.throws(() => buildBaselineReport({ repository: 'nope', collected_at: T(0), runs, jobs }), (error) => error.code === 'input_invalid');
});
