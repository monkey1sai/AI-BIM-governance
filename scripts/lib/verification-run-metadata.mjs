#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COMMIT = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const JOB_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/()\[\]-]{0,199}$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u;
const BODY_MAX_BYTES = 256 * 1024;
const ARTIFACT_TOTAL_MAX_BYTES = 128 * 1024 * 1024;
const ARTIFACT_MAX_BYTES = Object.freeze({
  'verification-plan': 2 * 1024 * 1024,
  'functional-runtime-conv': 64 * 1024 * 1024,
  'design-semantic-visual': 128 * 1024 * 1024,
});
const CONCLUSIONS = new Set([
  'success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure',
]);

function fail(message) {
  throw new Error(message);
}

function exactKeysSubset(value, required, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || required.some((key) => !(key in value))) {
    fail(`${label} is missing required fields`);
  }
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} is invalid`);
  return value;
}

function safeCommit(value, label) {
  if (typeof value !== 'string' || !COMMIT.test(value)) fail(`${label} is invalid`);
  return value;
}

function normalizedConclusion(value, label) {
  if (typeof value !== 'string' || !CONCLUSIONS.has(value)) fail(`${label} is invalid`);
  return value;
}

function sha256Utf8(value) {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function artifactPolicy(name, subjectSha, runAttempt) {
  const suffix = `${subjectSha}-attempt-${runAttempt}`;
  for (const [prefix, maxBytes] of Object.entries(ARTIFACT_MAX_BYTES)) {
    if (name === `${prefix}-${suffix}`) return { maxBytes };
  }
  fail('workflow run contains an unexpected artifact');
}

export function isCurrentSourceRun({ sourceRunId, sourceRunAttempt, pullRequestNumber, subjectSha, run }) {
  try {
    exactKeysSubset(run, ['id', 'run_attempt', 'event', 'head_sha', 'conclusion', 'pull_requests'], 'current_run');
    if (safeInteger(run.id, 'current_run.id') !== sourceRunId ||
        safeInteger(run.run_attempt, 'current_run.run_attempt') !== sourceRunAttempt ||
        run.event !== 'pull_request' || run.conclusion !== 'success' ||
        safeCommit(run.head_sha, 'current_run.head_sha') !== subjectSha ||
        !Array.isArray(run.pull_requests) || run.pull_requests.length !== 1 ||
        safeInteger(run.pull_requests[0]?.number, 'current_run.pull_request.number') !== pullRequestNumber) return false;
    return true;
  } catch {
    return false;
  }
}

export function buildWorkflowRunObservation({ repository, authority, repositoryInfo, run, workflow, jobs, artifacts, livePull, associatedPulls,
  expectedRunAttempt = null }) {
  if (typeof repository !== 'string' || !REPOSITORY.test(repository)) fail('repository is invalid');
  if (!['trusted_base', 'trusted_main', 'bootstrap_untrusted'].includes(authority)) fail('authority is invalid');
  exactKeysSubset(run, ['id', 'name', 'workflow_id', 'run_attempt', 'event', 'head_sha', 'conclusion', 'repository', 'pull_requests'], 'run');
  exactKeysSubset(repositoryInfo, ['id', 'full_name', 'default_branch'], 'repository_info');
  exactKeysSubset(workflow, ['id', 'name', 'path'], 'workflow');
  if (run.name !== 'CI' || workflow.name !== 'CI' || workflow.path !== '.github/workflows/ci.yml' ||
      safeInteger(run.workflow_id, 'run.workflow_id') !== safeInteger(workflow.id, 'workflow.id')) fail('source workflow identity is invalid');
  if (run.event !== 'pull_request') fail('only pull_request CI runs can produce merge authority');
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) fail('source run must bind exactly one pull request');
  const pull = run.pull_requests[0];
  exactKeysSubset(pull, ['number', 'head', 'base'], 'run.pull_request');
  exactKeysSubset(pull.head, ['sha'], 'run.pull_request.head');
  exactKeysSubset(pull.base, ['sha', 'ref', 'repo'], 'run.pull_request.base');
  exactKeysSubset(pull.base.repo, ['id'], 'run.pull_request.base.repo');
  exactKeysSubset(livePull, ['number', 'head', 'base', 'state', 'body'], 'live_pull');
  exactKeysSubset(livePull.head, ['sha'], 'live_pull.head');
  exactKeysSubset(livePull.base, ['sha', 'ref', 'repo'], 'live_pull.base');
  exactKeysSubset(livePull.base.repo, ['id'], 'live_pull.base.repo');
  const runId = safeInteger(run.id, 'run.id');
  const runAttempt = safeInteger(run.run_attempt, 'run.run_attempt');
  if (expectedRunAttempt !== null && safeInteger(expectedRunAttempt, 'expected_run_attempt') !== runAttempt) {
    fail('source run attempt no longer matches the triggering event');
  }
  const prNumber = safeInteger(pull.number, 'pull_request.number');
  if (safeInteger(livePull.number, 'live_pull.number') !== prNumber || livePull.state !== 'open') fail('live pull request identity or state changed');
  const subjectSha = safeCommit(pull.head.sha, 'pull_request.head.sha');
  const baseSha = safeCommit(pull.base.sha, 'pull_request.base.sha');
  const liveHeadSha = safeCommit(livePull.head.sha, 'live_pull.head.sha');
  if (safeCommit(run.head_sha, 'run.head_sha') !== subjectSha || safeCommit(livePull.base.sha, 'live_pull.base.sha') !== baseSha) {
    fail('source run and live pull request base/head are inconsistent');
  }
  if (liveHeadSha !== subjectSha) fail('source run is stale relative to the live pull request head');
  exactKeysSubset(run.repository, ['id', 'full_name'], 'run.repository');
  if (run.repository.full_name.toLowerCase() !== repository.toLowerCase()) fail('source run repository changed');
  const repositoryId = safeInteger(run.repository.id, 'run.repository.id');
  if (safeInteger(repositoryInfo.id, 'repository_info.id') !== repositoryId ||
      repositoryInfo.full_name.toLowerCase() !== repository.toLowerCase() ||
      typeof repositoryInfo.default_branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(repositoryInfo.default_branch) ||
      pull.base.ref !== repositoryInfo.default_branch || livePull.base.ref !== repositoryInfo.default_branch ||
      pull.base.repo.id !== repositoryId || livePull.base.repo.id !== repositoryId) {
    fail('pull request base is not the protected default branch in this repository');
  }
  if (!Array.isArray(associatedPulls) || associatedPulls.length >= 100) {
    fail('associated pull request collection is truncated or unbounded');
  }
  const authoritativePulls = associatedPulls.filter((candidate) => {
    try {
      exactKeysSubset(candidate, ['number', 'state', 'head', 'base'], 'associated_pull');
      exactKeysSubset(candidate.head, ['sha'], 'associated_pull.head');
      exactKeysSubset(candidate.base, ['ref', 'repo'], 'associated_pull.base');
      exactKeysSubset(candidate.base.repo, ['id'], 'associated_pull.base.repo');
      return candidate.state === 'open' && candidate.head.sha === subjectSha && candidate.base.ref === repositoryInfo.default_branch &&
        candidate.base.repo.id === repositoryId;
    } catch {
      return false;
    }
  });
  if (authoritativePulls.length !== 1 || authoritativePulls[0].number !== prNumber) {
    fail('one commit cannot grant merge authority to multiple open pull requests');
  }
  if (typeof livePull.body !== 'string' || Buffer.byteLength(livePull.body, 'utf8') > BODY_MAX_BYTES) fail('pull request body is invalid or too large');
  const bodySha256 = sha256Utf8(livePull.body);
  if (!Array.isArray(jobs) || jobs.length > 200 || !Array.isArray(artifacts) || artifacts.length > 3) fail('job or artifact collection is unbounded');
  const jobResults = jobs.map((job) => {
    exactKeysSubset(job, ['name', 'conclusion', 'run_attempt'], 'job');
    if (typeof job.name !== 'string' || !JOB_NAME.test(job.name) || job.run_attempt !== runAttempt) fail('job identity or attempt is invalid');
    return { name: job.name, conclusion: normalizedConclusion(job.conclusion, 'job.conclusion') };
  }).sort((left, right) => left.name.localeCompare(right.name, 'en'));
  let artifactTotalBytes = 0;
  const artifactIds = new Set();
  const artifactNames = new Set();
  const artifactResults = artifacts.map((artifact) => {
    exactKeysSubset(artifact, ['id', 'name', 'size_in_bytes', 'expired', 'workflow_run'], 'artifact');
    exactKeysSubset(artifact.workflow_run, ['id', 'head_sha'], 'artifact.workflow_run');
    const artifactId = safeInteger(artifact.id, 'artifact.id');
    if (typeof artifact.name !== 'string' || !ARTIFACT_NAME.test(artifact.name) || artifactIds.has(artifactId) || artifactNames.has(artifact.name) ||
        !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 ||
        typeof artifact.expired !== 'boolean' || artifact.workflow_run.id !== runId ||
        safeCommit(artifact.workflow_run.head_sha, 'artifact.workflow_run.head_sha') !== subjectSha) fail('artifact metadata is invalid');
    const policy = artifactPolicy(artifact.name, subjectSha, runAttempt);
    if (artifact.size_in_bytes > policy.maxBytes) fail('workflow artifact exceeds its compressed-size budget');
    artifactTotalBytes += artifact.size_in_bytes;
    if (artifactTotalBytes > ARTIFACT_TOTAL_MAX_BYTES) fail('workflow artifacts exceed the aggregate compressed-size budget');
    artifactIds.add(artifactId);
    artifactNames.add(artifact.name);
    return {
      id: artifactId,
      name: artifact.name,
      size_in_bytes: artifact.size_in_bytes,
      expired: artifact.expired,
      source_run_id: runId,
      source_run_attempt: runAttempt,
      subject_sha: subjectSha,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return {
    schema_version: 'verification-job-results/v1',
    authority,
    repository,
    repository_id: repositoryId,
    source_workflow: 'CI',
    source_workflow_id: workflow.id,
    source_workflow_path: '.github/workflows/ci.yml',
    source_run_id: runId,
    source_run_attempt: runAttempt,
    event_name: 'pull_request',
    pull_request_number: prNumber,
    body_sha256: bodySha256,
    base_ref: repositoryInfo.default_branch,
    base_sha: baseSha,
    subject_sha: subjectSha,
    live_head_sha: liveHeadSha,
    source_conclusion: normalizedConclusion(run.conclusion, 'run.conclusion'),
    jobs: jobResults,
    artifacts: artifactResults,
  };
}

async function api(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'ai-bim-base-pinned-merge-evidence',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`GitHub API request failed with status ${response.status}`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) fail('GitHub API response exceeded the size limit');
  return JSON.parse(text);
}

async function collect(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) fail('GITHUB_TOKEN is unavailable');
  const repository = args.repository;
  if (!REPOSITORY.test(repository)) fail('repository is invalid');
  const runId = Number(args.runId);
  safeInteger(runId, 'run_id');
  const expectedRunAttempt = safeInteger(Number(args.expectedRunAttempt), 'expected_run_attempt');
  const run = await api(`/repos/${repository}/actions/runs/${runId}`, token);
  const repositoryInfo = await api(`/repos/${repository}`, token);
  const workflow = await api(`/repos/${repository}/actions/workflows/${run.workflow_id}`, token);
  const attempt = safeInteger(run.run_attempt, 'run.run_attempt');
  const jobPage = await api(`/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, token);
  if (jobPage.total_count > 100 || !Array.isArray(jobPage.jobs)) fail('workflow run has too many jobs');
  const artifactPage = await api(`/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`, token);
  if (artifactPage.total_count > 100 || !Array.isArray(artifactPage.artifacts)) fail('workflow run has too many artifacts');
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) fail('source run does not bind one pull request');
  const prNumber = safeInteger(run.pull_requests[0].number, 'pull_request.number');
  const livePull = await api(`/repos/${repository}/pulls/${prNumber}`, token);
  const associatedPulls = await api(`/repos/${repository}/commits/${run.head_sha}/pulls?per_page=100`, token);
  const observation = buildWorkflowRunObservation({
    repository, authority: args.authority, repositoryInfo, run, workflow, jobs: jobPage.jobs,
    artifacts: artifactPage.artifacts, livePull, associatedPulls, expectedRunAttempt,
  });
  writeFileSync(path.resolve(args.output), `${JSON.stringify(observation)}\n`, 'utf8');
  writeFileSync(path.resolve(args.bodyOutput), livePull.body, 'utf8');
  if (args.githubOutput) {
    appendFileSync(path.resolve(args.githubOutput), [
      `repository_id=${observation.repository_id}`,
      `workflow_id=${observation.source_workflow_id}`,
      `run_attempt=${observation.source_run_attempt}`,
      `pr_number=${observation.pull_request_number}`,
      `body_sha256=${observation.body_sha256}`,
      `base_sha=${observation.base_sha}`,
      `subject_sha=${observation.subject_sha}`,
    ].join('\n') + '\n', 'utf8');
  }
  process.stdout.write(`${JSON.stringify({ result: 'collected', run_id: observation.source_run_id, attempt })}\n`);
}

function parseArgs(argv) {
  const command = argv[0];
  const allowed = command === 'collect'
    ? new Map([['--repository', 'repository'], ['--run-id', 'runId'], ['--expected-run-attempt', 'expectedRunAttempt'],
      ['--authority', 'authority'], ['--output', 'output'], ['--body-output', 'bodyOutput'], ['--github-output', 'githubOutput']])
    : null;
  if (allowed === null) fail('command must be collect');
  const result = { command };
  for (let index = 1; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || result[key] !== undefined) fail('arguments are invalid');
    result[key] = value;
  }
  const required = ['repository', 'runId', 'expectedRunAttempt', 'authority', 'output', 'bodyOutput'];
  if (required.some((key) => result[key] === undefined)) fail('a required argument is missing');
  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    await collect(args);
  } catch {
    process.stderr.write('[verification-run-metadata] request failed closed.\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
