#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AiCodingMetricsError,
  readBoundedJson,
  writeTelemetryObservation,
} from '../lib/ai-coding-metrics.mjs';

function parseArguments(argv) {
  const options = {};
  const flags = new Map([
    ['--repo-root', 'repoRoot'], ['--policy', 'policy'], ['--input', 'input'], ['--out', 'out'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || options[key] !== undefined) {
      throw new AiCodingMetricsError('invalid_argument', 'Telemetry recorder arguments are invalid.');
    }
    options[key] = value;
    index += 1;
  }
  if (!options.repoRoot || !options.input || !options.out) {
    throw new AiCodingMetricsError('invalid_argument', '--repo-root, --input, and --out are required.');
  }
  options.policy ??= 'scripts/ai-coding-metrics-policy.json';
  return options;
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const repoRoot = path.resolve(options.repoRoot);
    const policy = readBoundedJson(repoRoot, options.policy, 'policy');
    const observation = readBoundedJson(repoRoot, options.input, 'observation');
    const written = writeTelemetryObservation(repoRoot, options.out, observation, policy);
    process.stdout.write(`[TELEMETRY] ${written}\n`);
  } catch (error) {
    const code = error instanceof AiCodingMetricsError ? error.code : 'unexpected_failure';
    process.stderr.write(`Telemetry observation rejected: ${code}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) run();
