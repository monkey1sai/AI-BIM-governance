#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AiCodingMetricsError,
  buildAiCodingMetricsReport,
  readBoundedJson,
  readTelemetryArtifact,
  writeAiCodingMetricsReport,
} from '../lib/ai-coding-metrics.mjs';

function parseArguments(argv) {
  const options = { observations: [] };
  const flags = new Map([
    ['--repo-root', 'repoRoot'], ['--policy', 'policy'], ['--observed-at', 'observedAt'],
    ['--observation', 'observation'], ['--lifecycle', 'lifecycle'], ['--task-corpus', 'taskCorpus'], ['--out', 'out'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--')) {
      throw new AiCodingMetricsError('invalid_argument', 'Metrics reporter arguments are invalid.');
    }
    index += 1;
    if (key === 'observation') options.observations.push(value);
    else if (options[key] !== undefined) throw new AiCodingMetricsError('invalid_argument', `Duplicate argument: ${argv[index - 1]}`);
    else options[key] = value;
  }
  if (!options.repoRoot || !options.observedAt || !options.out || options.observations.length > 500) {
    throw new AiCodingMetricsError('invalid_argument', '--repo-root, --observed-at, and --out are required.');
  }
  options.policy ??= 'scripts/ai-coding-metrics-policy.json';
  return options;
}

function run() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const repoRoot = path.resolve(options.repoRoot);
    const policy = readBoundedJson(repoRoot, options.policy, 'policy');
    const observations = [];
    let observationBytes = 0;
    for (const item of options.observations) {
      const artifact = readTelemetryArtifact(repoRoot, item, policy);
      observationBytes += artifact.size_bytes;
      if (observationBytes > 16 * 1024 * 1024) {
        throw new AiCodingMetricsError('input_too_large', 'Telemetry inputs exceed the cumulative report limit.');
      }
      observations.push(artifact);
    }
    const lifecycleLedger = options.lifecycle ? readBoundedJson(repoRoot, options.lifecycle, 'lifecycle') : null;
    const taskPacketCorpus = options.taskCorpus ? readBoundedJson(repoRoot, options.taskCorpus, 'task_corpus') : null;
    const report = buildAiCodingMetricsReport({
      policy, generatedAt: options.observedAt, observations, lifecycleLedger, taskPacketCorpus,
    });
    const written = writeAiCodingMetricsReport(repoRoot, options.out, report);
    process.stdout.write(`[METRICS] ${written} — ${report.window.phase}\n`);
  } catch (error) {
    const code = error instanceof AiCodingMetricsError ? error.code : 'unexpected_failure';
    process.stderr.write(`AI coding metrics report rejected: ${code}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) run();
