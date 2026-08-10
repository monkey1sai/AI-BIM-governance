#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceReviewLoop,
  buildReviewPacket,
  classifyReview,
  readJson,
  replayCorpus,
  sha256Value,
  validatePolicy,
  validateReviewResult,
} from '../lib/risk-proportional-review.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');
const repoRootReal = await realpath(repoRoot);
const defaultPolicyPath = resolve(repoRoot, 'agent-contracts', 'risk-proportional-review.contract.json');

function assertContained(absolute, root, name) {
  const relativePath = relative(root, absolute);
  const outside = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  if (outside) throw new Error(`--${name} must resolve inside ${root}`);
  return absolute;
}

async function resolveReadPath(value, name) {
  const lexicalPath = assertContained(resolve(process.cwd(), value), repoRoot, name);
  const realPath = await realpath(lexicalPath);
  return assertContained(realPath, repoRootReal, name);
}

function usage() {
  return `Usage:
  node scripts/dev/review-risk-shadow.mjs evaluate --input <json> [--policy <json>]
  node scripts/dev/review-risk-shadow.mjs packet   --input <json> [--policy <json>]
  node scripts/dev/review-risk-shadow.mjs loop     --input <json>
  node scripts/dev/review-risk-shadow.mjs validate-result --packet <json> --result <json>
  node scripts/dev/review-risk-shadow.mjs replay   --corpus <json> [--policy <json>]
  node scripts/dev/review-risk-shadow.mjs policy-hash [--policy <json>]

This command is read-only and advisory. It never calls GitHub, starts an agent,
posts a comment, applies a label, approves, merges, or changes branch protection.`;
}

function parseArgs(argv) {
  if (argv.length === 0 || ['-h', '--help', 'help'].includes(argv[0])) return { command: 'help', options: {} };
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`duplicate option --${name}`);
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

async function requireOption(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return resolveReadPath(value, name);
}

function rejectUnknownOptions(options, allowed) {
  for (const name of Object.keys(options)) {
    if (!allowed.includes(name)) throw new Error(`unknown option --${name}`);
  }
}

async function loadPolicy(options) {
  const path = await resolveReadPath(options.policy ?? defaultPolicyPath, 'policy');
  return validatePolicy(await readJson(path));
}

function emit(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  process.stdout.write(text);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === 'evaluate') {
    rejectUnknownOptions(options, ['input', 'policy']);
    const input = await readJson(await requireOption(options, 'input'));
    const policy = await loadPolicy(options);
    emit(classifyReview(input, policy));
    return;
  }

  if (command === 'packet') {
    rejectUnknownOptions(options, ['input', 'policy']);
    const input = await readJson(await requireOption(options, 'input'));
    const policy = await loadPolicy(options);
    const decision = classifyReview(input, policy);
    emit(buildReviewPacket(input, decision, policy));
    return;
  }

  if (command === 'loop') {
    rejectUnknownOptions(options, ['input']);
    const input = await readJson(await requireOption(options, 'input'));
    emit(advanceReviewLoop(input));
    return;
  }

  if (command === 'validate-result') {
    rejectUnknownOptions(options, ['packet', 'result']);
    const packet = await readJson(await requireOption(options, 'packet'));
    const result = await readJson(await requireOption(options, 'result'));
    emit(validateReviewResult(result, packet));
    return;
  }

  if (command === 'replay') {
    rejectUnknownOptions(options, ['corpus', 'policy']);
    const corpus = await readJson(await requireOption(options, 'corpus'));
    const policy = await loadPolicy(options);
    const report = replayCorpus(corpus, policy);
    emit(report);
    if (report.failed > 0) process.exitCode = 1;
    return;
  }

  if (command === 'policy-hash') {
    rejectUnknownOptions(options, ['policy']);
    const policy = await loadPolicy(options);
    process.stdout.write(`${sha256Value(policy)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}\n\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`[review-risk-shadow] ${error.message}\n`);
  process.exitCode = 2;
});
