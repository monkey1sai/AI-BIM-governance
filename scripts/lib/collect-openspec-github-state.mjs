#!/usr/bin/env node
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const COMMIT = /^[0-9a-f]{40}$/u;
const CHANGE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

function fail(message) { throw new Error(message); }

function readBoundedJson(filePath, label) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 2 * 1024 * 1024) fail(`${label} is not a bounded regular file`);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath)));
  } catch {
    fail(`${label} is invalid JSON`);
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function buildGitHubLifecycleObservation({ ledger, repository, repositoryInfo, pulls, subject }) {
  if (!REPOSITORY.test(repository) || !COMMIT.test(subject) || ledger?.schema_version !== 'openspec-lifecycle-ledger/v1' ||
      !Array.isArray(ledger.changes) || ledger.changes.length > 500 || !Array.isArray(pulls) || pulls.length > 1000 ||
      repositoryInfo?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      !Number.isSafeInteger(repositoryInfo?.id) || repositoryInfo.id < 1) fail('GitHub lifecycle input is invalid or unbounded');
  const current = ledger.changes.filter(({ status }) => status !== 'archived');
  const ids = new Set();
  for (const change of current) {
    if (!CHANGE_ID.test(change?.id) || ids.has(change.id) || change.subject_commit !== subject) fail('current ledger identity is invalid');
    ids.add(change.id);
  }
  const mappedPrs = new Set();
  const changes = current.map(({ id }) => {
    const expectedRef = `codex/openspec/${id}`;
    const prs = pulls.filter((pr) => pr?.head?.ref === expectedRef && pr?.head?.repo?.id === repositoryInfo.id).map((pr) => {
      if (!Number.isSafeInteger(pr.number) || pr.number < 1 || !COMMIT.test(pr?.head?.sha) ||
          !['open', 'closed'].includes(pr.state) || (pr.merged_at !== null && typeof pr.merged_at !== 'string')) fail('GitHub pull request observation is invalid');
      if (mappedPrs.has(pr.number)) fail('one pull request mapped to multiple OpenSpec changes');
      mappedPrs.add(pr.number);
      return { number: pr.number, state: pr.merged_at === null ? pr.state : 'merged', head_sha: pr.head.sha };
    }).sort((left, right) => left.number - right.number);
    return { id, prs };
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return { schema_version: 'openspec-github-lifecycle-state/v1', scope: 'current', repository_subject: subject, changes };
}

async function githubApi(repository, pathname, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}${pathname}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'User-Agent': 'ai-bim-openspec-lifecycle-observer', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`GitHub API returned status ${response.status}`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) fail('GitHub API response exceeded its byte budget');
  return JSON.parse(text);
}

function parseArgs(argv) {
  const allowed = new Map([['--repository', 'repository'], ['--repo-root', 'repoRoot'], ['--ledger', 'ledger'],
    ['--subject', 'subject'], ['--output', 'output']]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || result[key] !== undefined) fail('arguments are invalid');
    result[key] = value;
  }
  if ([...allowed.values()].some((key) => !result[key])) fail('a required argument is missing');
  return result;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const token = process.env.GITHUB_TOKEN;
    if (!token || !REPOSITORY.test(args.repository)) fail('GitHub request identity is unavailable');
    const repoRoot = realpathSync(path.resolve(args.repoRoot));
    const ledgerPath = realpathSync(path.resolve(repoRoot, args.ledger));
    const outputPath = path.resolve(repoRoot, args.output);
    const outputParent = realpathSync(path.dirname(outputPath));
    if (!isWithin(repoRoot, ledgerPath) || !isWithin(repoRoot, outputPath) || !isWithin(repoRoot, outputParent)) {
      fail('repository input or output escaped its trusted root');
    }
    const ledger = readBoundedJson(ledgerPath, 'ledger');
    const repositoryInfo = await githubApi(args.repository, '', token);
    const pulls = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await githubApi(args.repository, `/pulls?state=all&per_page=100&page=${page}`, token);
      if (!Array.isArray(batch) || batch.length > 100) fail('GitHub pull request page is invalid');
      pulls.push(...batch);
      if (batch.length < 100) break;
      if (page === 10) fail('GitHub pull request observation exceeded 1000 items');
    }
    const observation = buildGitHubLifecycleObservation({ ledger, repository: args.repository, repositoryInfo, pulls, subject: args.subject });
    writeFileSync(outputPath, `${JSON.stringify(observation)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ result: 'collected', change_count: observation.changes.length })}\n`);
  } catch {
    process.stderr.write('[collect-openspec-github-state] observation failed closed.\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
