#!/usr/bin/env node
// Read-only shard selector for the Agent Governance scope job.
//
// Reads the changed paths the plan already computed and prints the matrix legs the suite needs.
// Mutates nothing; the only side effect is appending to $GITHUB_OUTPUT when asked.
//
//   node scripts/dev/select-agent-governance-shards.mjs \
//     --plan verification-plan.json [--github-output "$GITHUB_OUTPUT"] [--json]

import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectShards } from '../lib/agent-governance-shards.mjs';

function parseArgs(argv) {
  const options = { policy: 'scripts/agent-governance-shards.json', json: false };
  let index = 0;
  while (index < argv.length) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--json') { options.json = true; index += 1; continue; }
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--plan') options.plan = value;
    else if (flag === '--policy') options.policy = value;
    else if (flag === '--github-output') options.githubOutput = value;
    else throw new Error(`unknown argument ${flag}`);
    index += 2;
  }
  if (!options.plan) throw new Error('--plan is required');
  return options;
}

const options = parseArgs(process.argv.slice(2));
const plan = JSON.parse(readFileSync(resolve(options.plan), 'utf8'));
if (plan?.schema_version !== 'verification-plan/v2') {
  throw new Error('plan must be a verification-plan/v2 document');
}
const policy = JSON.parse(readFileSync(resolve(options.policy), 'utf8'));

const changedPaths = (plan.changed_paths ?? []).filter((path) => path !== '__full__');
const full = plan.dispatch === 'full';
const result = selectShards(policy, { changedPaths, full });

if (options.githubOutput) {
  // fromJSON() in the matrix needs a compact JSON array on one line.
  appendFileSync(options.githubOutput, `shards=${JSON.stringify(result.shards)}\n`, 'utf8');
  appendFileSync(options.githubOutput, `shard_policy_sha256=${result.policy_sha256}\n`, 'utf8');
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`shards: ${result.shards.join(', ')}${full ? ' (full dispatch)' : ''}\n`);
  for (const [shard, reason] of Object.entries(result.reasons)) {
    process.stdout.write(`  ${shard}: ${reason}\n`);
  }
}
