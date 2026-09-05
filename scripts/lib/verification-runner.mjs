#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { createVerificationPlan, VerificationPlanError } from './verification-plan.mjs';
import { assertSafeVerificationCommand, SAFE_VERIFICATION_EXECUTABLES } from './verification-command-policy.mjs';
import { hashJson, writeVerificationOutcome } from './verification-outcome.mjs';
import { TIERS, selectTierGates, tierSelectionKey, validateTierPolicy } from './verification-tiers.mjs';

const EXECUTABLES = SAFE_VERIFICATION_EXECUTABLES;

function fail(message, exitCode = 3) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArguments(argv) {
  const options = { paths: [], full: false, continueOnError: false, planOnly: false, json: false };
  const valueFlags = new Map([
    ['--repo-root', 'repoRoot'], ['--manifest', 'manifest'], ['--path', 'path'], ['--default-profile', 'defaultProfile'],
    ['--base', 'baseSha'], ['--subject', 'subjectSha'], ['--outcome-out', 'outcomeOut'], ['--tier', 'tier'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--full') options.full = true;
    else if (flag === '--continue-on-error') options.continueOnError = true;
    else if (flag === '--plan-only') options.planOnly = true;
    else if (flag === '--json') options.json = true;
    else {
      const key = valueFlags.get(flag);
      const value = argv[index + 1];
      if (!key || value === undefined || value.startsWith('--')) fail(`Invalid argument: ${flag}`);
      index += 1;
      if (key === 'path') options.paths.push(value);
      else if (options[key] !== undefined) fail(`Duplicate argument: ${flag}`);
      else options[key] = value;
    }
  }
  if (!options.repoRoot || !options.manifest) fail('--repo-root and --manifest are required.');
  if (options.json && !options.planOnly) fail('--json is supported only with --plan-only.');
  if (options.outcomeOut && (options.planOnly || options.json)) fail('--outcome-out is supported only while executing gates.');
  if (options.outcomeOut && !/^[0-9a-f]{40}$/u.test(options.subjectSha ?? '')) fail('--outcome-out requires a lowercase full --subject commit.');
  // --base is provenance only (mirrors the planner CLI); the adapters derive changed paths from it.
  if (options.baseSha !== undefined && !/^[0-9a-f]{40}$/u.test(options.baseSha)) fail('--base requires a lowercase full commit id.');
  if (options.tier !== undefined && !TIERS.includes(options.tier)) fail(`--tier must be one of ${TIERS.join(', ')}.`);
  // A tiered run executes a subset of the plan and is therefore never commit-bound evidence.
  if (options.tier !== undefined && options.outcomeOut) fail('--tier cannot be combined with --outcome-out: a tiered run is not verification evidence.');
  return options;
}

function readManifest(filePath) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 2 * 1024 * 1024) fail('Manifest must be a bounded regular file.');
  try {
    const bytes = readFileSync(filePath);
    return {
      document: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    fail('Manifest is not valid UTF-8 JSON.');
  }
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isWithin(root, candidate, allowEqual = false) {
  const rootKey = pathKey(path.resolve(root));
  const candidateKey = pathKey(path.resolve(candidate));
  return (allowEqual && candidateKey === rootKey) || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function gateWorkingDirectory(repoRoot, relativePath) {
  const candidate = path.resolve(repoRoot, relativePath);
  if (!isWithin(repoRoot, candidate, true)) fail(`Gate cwd escapes the repository: ${relativePath}`);
  if (!existsSync(candidate)) return null;
  let cursor = repoRoot;
  for (const segment of path.relative(repoRoot, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) fail(`Gate cwd contains a link or reparse component: ${relativePath}`);
  }
  const real = realpathSync(candidate);
  if (!isWithin(repoRoot, real, true) || !lstatSync(real).isDirectory()) fail(`Gate cwd is not a trusted repository directory: ${relativePath}`);
  return real;
}

function resolveExecutable(repoRoot, logical) {
  if (!EXECUTABLES.has(logical)) fail(`Gate executable is not allowed: ${logical}`);
  if (logical === 'python') {
    const candidates = process.platform === 'win32'
      ? [path.join(repoRoot, '.venv', 'Scripts', 'python.exe')]
      : [path.join(repoRoot, '.venv', 'bin', 'python'), path.join(repoRoot, '.venv', 'Scripts', 'python.exe')];
    return candidates.find(existsSync) ?? 'python';
  }
  if (process.platform === 'win32' && logical === 'npm') return 'npm.cmd';
  if (process.platform === 'win32' && logical === 'npx') return 'npx.cmd';
  return logical;
}

function gitOutput(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, '--no-optional-locks', ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== 'string') {
    fail('Verification outcome requires a readable Git repository.');
  }
  return result.stdout.trim();
}

function assertOutcomeCheckout(repoRoot, subjectSha) {
  if (gitOutput(repoRoot, ['rev-parse', 'HEAD']) !== subjectSha) {
    fail('Verification outcome subject does not match repository HEAD.');
  }
  if (gitOutput(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    fail('Verification outcome requires a clean working tree.');
  }
}

function displayPlan(plan, tierSelected = null) {
  if (plan.dispatch === 'profile') process.stdout.write('[PLAN] profile=developer\n');
  else process.stdout.write(`[PLAN] dispatch=${plan.dispatch} result=${plan.result}\n`);
  for (const target of plan.targets) {
    if (!target.required) continue;
    for (const gate of target.gates) {
      if (gate.command === null) process.stdout.write(`[POLICY] ${target.display_name} [${gate.id}] — not_configured:${gate.not_configured_reason}\n`);
      else if (tierSelected !== null && !tierSelected.has(tierSelectionKey({ target_id: target.id, gate_id: gate.id }))) {
        const name = target.gates.length > 1 ? `${target.display_name} [${gate.id}]` : target.display_name;
        process.stdout.write(`[TIER-SKIP] ${name} — tier_deselected:${gate.evidence_class}\n`);
      } else {
        const detail = `${gate.command.executable} ${gate.command.args.join(' ')}`.trim();
        process.stdout.write(`[EXECUTE] ${target.display_name} — ${detail}\n`);
      }
    }
  }
}

const options = parseArguments(process.argv.slice(2));
let repoRoot;
let manifestPath;
try {
  repoRoot = realpathSync(path.resolve(options.repoRoot));
  manifestPath = realpathSync(path.resolve(options.manifest));
} catch {
  fail('Repository root or manifest is unavailable.');
}
if (!isWithin(repoRoot, manifestPath)) fail('Manifest must be repository-contained.');

const manifestInput = readManifest(manifestPath);
let plan;
try {
  plan = createVerificationPlan(manifestInput.document, {
    changedPaths: options.paths,
    defaultProfile: options.defaultProfile ?? null,
    baseSha: options.baseSha ?? null,
    subjectSha: options.subjectSha ?? null,
    full: options.full,
  });
} catch (error) {
  if (error instanceof VerificationPlanError) fail(`${error.code}: ${error.message}`, 3);
  fail('Verification planning failed safely.', 3);
}

// Optional local tier selection over the canonical plan (sidecar; CI never reads it).
let tierSelected = null;
if (options.tier !== undefined && plan.result === 'planned') {
  const tierPolicyPath = path.join(repoRoot, 'scripts', 'verification-tier-policy.json');
  if (!isWithin(repoRoot, tierPolicyPath)) fail('Tier policy must be repository-contained.');
  let tierPolicy;
  try {
    tierPolicy = validateTierPolicy(readManifest(tierPolicyPath).document);
  } catch (error) {
    fail(`Tier policy is unusable: ${error.message}`);
  }
  const selection = selectTierGates(plan, options.tier, tierPolicy);
  tierSelected = new Set(selection.selected.map(tierSelectionKey));
  if (!options.json) {
    if (selection.forced_full) process.stdout.write(`[TIER] requested=${selection.requested_tier} effective=full — ${selection.forced_full_reason}\n`);
    else process.stdout.write(`[TIER] ${selection.effective_tier} (${selection.selected.length} selected, ${selection.deselected.length} deselected; not evidence)\n`);
  }
}

if (options.json) {
  process.stdout.write(`${JSON.stringify(plan)}\n`);
  process.exit(plan.result === 'planned' ? 0 : 2);
}
displayPlan(plan, tierSelected);
if (plan.result !== 'planned') process.exit(2);
if (options.planOnly) process.exit(0);
if (options.outcomeOut) assertOutcomeCheckout(repoRoot, options.subjectSha);

const failures = [];
const passed = [];
const advisoryFailures = [];
const gateOutcomes = [];
const outcomeStarted = new Date();
const outcomeStartedMs = Date.now();
let stopped = false;
for (const target of plan.targets) {
  if (!target.required) continue;
  for (const gate of target.gates) {
    const name = target.gates.length > 1 ? `${target.display_name} [${gate.id}]` : target.display_name;
    const outcome = {
      target_id: target.id,
      gate_id: gate.id,
      capabilities: [...gate.capabilities],
      enforcement: gate.enforcement,
      command: gate.command === null ? null : structuredClone(gate.command),
      cwd: gate.cwd,
      subject_sha: plan.subject_sha,
      duration_ms: 0,
      exit_code: null,
      result: 'not_run',
      reason: 'fail_fast',
      report_sha256: null,
    };
    if (!gate.configured) {
      outcome.result = 'not_configured';
      outcome.reason = gate.not_configured_reason;
      gateOutcomes.push(outcome);
      process.stdout.write(`[SKIP] ${name} — not_configured:${gate.not_configured_reason}\n`);
      continue;
    }
    if (tierSelected !== null && !tierSelected.has(tierSelectionKey({ target_id: target.id, gate_id: gate.id }))) {
      process.stdout.write(`[TIER-SKIP] ${name} — tier_deselected:${gate.evidence_class}\n`);
      continue;
    }
    if (stopped) {
      gateOutcomes.push(outcome);
      continue;
    }
    const cwd = gateWorkingDirectory(repoRoot, gate.cwd);
    if (cwd === null) {
      if (plan.dispatch === 'profile') {
        outcome.result = 'skipped';
        outcome.reason = 'optional_directory_missing';
        gateOutcomes.push(outcome);
        process.stdout.write(`[SKIP] ${name} — optional_directory_missing\n`);
        continue;
      }
      outcome.result = 'failed';
      outcome.reason = 'required_directory_missing';
      gateOutcomes.push(outcome);
      if (gate.enforcement === 'required') failures.push(name);
      else advisoryFailures.push(name);
      process.stderr.write(`[FAIL] ${name} — required_directory_missing\n`);
      if (!options.continueOnError && gate.enforcement === 'required') stopped = true;
      continue;
    }
    const executable = resolveExecutable(repoRoot, gate.command.executable);
    try {
      assertSafeVerificationCommand(gate.command);
    } catch {
      fail(`Gate command policy changed after planning: ${gate.id}`);
    }
    process.stdout.write(`\n==> [${name}] ${gate.command.executable} ${gate.command.args.join(' ')}\n`);
    const gateStarted = Date.now();
    const result = spawnSync(executable, gate.command.args, { cwd, stdio: 'inherit', shell: false, windowsHide: true });
    const code = result.error ? 1 : (result.status ?? 1);
    outcome.duration_ms = Math.max(0, Date.now() - gateStarted);
    outcome.exit_code = code;
    if (code === 0) {
      outcome.result = 'passed';
      outcome.reason = null;
      passed.push(name);
      process.stdout.write(`[OK]   ${name}\n`);
    } else {
      outcome.result = 'failed';
      outcome.reason = result.error ? 'process_spawn_error' : 'exit_nonzero';
      if (gate.enforcement === 'required') failures.push(name);
      else advisoryFailures.push(name);
      process.stderr.write(`[FAIL] ${name} (exit ${code})\n`);
      if (!options.continueOnError && gate.enforcement === 'required') stopped = true;
    }
    gateOutcomes.push(outcome);
  }
}

const incomplete = gateOutcomes.length === 0 || gateOutcomes.some(({ result }) => ['not_configured', 'not_run', 'skipped'].includes(result));
const outcomeResult = failures.length > 0 ? 'failed' : (incomplete ? 'incomplete' : (advisoryFailures.length > 0 ? 'passed_with_advisories' : 'passed'));
if (options.outcomeOut) {
  try {
    assertOutcomeCheckout(repoRoot, options.subjectSha);
    const writtenPath = writeVerificationOutcome(repoRoot, options.outcomeOut, {
      schema_version: 'verification-outcome/v1',
      manifest_version: plan.manifest_version,
      manifest_sha256: manifestInput.sha256,
      plan_sha256: hashJson(plan),
      base_sha: plan.base_sha,
      subject_sha: plan.subject_sha,
      dispatch: plan.dispatch,
      started_at: outcomeStarted.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Math.max(0, Date.now() - outcomeStartedMs),
      result: outcomeResult,
      gates: gateOutcomes,
    }, plan);
    process.stdout.write(`[OUTCOME] ${writtenPath} — ${outcomeResult}\n`);
  } catch (error) {
    fail(`Outcome artifact could not be written safely: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

process.stdout.write('\n======================================\n');
process.stdout.write(`Passed: ${passed.join(', ') || '<none>'}\n`);
process.stdout.write(`Failed: ${failures.join(', ') || '<none>'}\n`);
process.stdout.write(`Advisory failures: ${advisoryFailures.join(', ') || '<none>'}\n`);
process.stdout.write('======================================\n');
process.exit(failures.length > 0 ? 1 : 0);
