import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertSafeVerificationCommand } from './verification-command-policy.mjs';

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const RESULTS = new Set(['passed', 'failed', 'passed_with_advisories', 'incomplete']);
const GATE_RESULTS = new Set(['passed', 'failed', 'not_configured', 'not_run', 'skipped']);
const CAPABILITIES = new Set(['types', 'lint', 'unit', 'contract', 'build', 'static-analysis', 'deployment-contract',
  'visual', 'runtime', 'secret', 'dependency', 'sast', 'changed-lines-coverage']);
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function reject(message) { throw new Error(message); }
function pathKey(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function within(root, candidate) {
  const left = pathKey(path.resolve(root));
  const right = pathKey(path.resolve(candidate));
  return right.startsWith(`${left}${path.sep}`);
}

export function hashJson(value) {
  return createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
}

function deriveResult(gates) {
  if (gates.some((gate) => gate.enforcement === 'required' && gate.result === 'failed')) return 'failed';
  if (gates.length === 0 || gates.some((gate) => ['not_configured', 'not_run', 'skipped'].includes(gate.result))) return 'incomplete';
  if (gates.some((gate) => gate.enforcement === 'advisory' && gate.result === 'failed')) return 'passed_with_advisories';
  return 'passed';
}

export function validateVerificationOutcome(outcome, expectedPlan = null) {
  const keys = ['schema_version', 'manifest_version', 'manifest_sha256', 'plan_sha256', 'base_sha', 'subject_sha',
    'dispatch', 'started_at', 'completed_at', 'duration_ms', 'result', 'gates'];
  if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome) ||
      JSON.stringify(Object.keys(outcome).sort()) !== JSON.stringify(keys.sort()) ||
      outcome.schema_version !== 'verification-outcome/v1' || outcome.manifest_version !== 'verification-manifest/v2' ||
      !SHA256.test(outcome.manifest_sha256) ||
      !SHA256.test(outcome.plan_sha256) || !SHA.test(outcome.subject_sha) ||
      (outcome.base_sha !== null && !SHA.test(outcome.base_sha)) || !RESULTS.has(outcome.result) ||
      !['affected', 'full', 'profile'].includes(outcome.dispatch) || !TIMESTAMP.test(outcome.started_at) || !TIMESTAMP.test(outcome.completed_at) ||
      !Number.isFinite(Date.parse(outcome.started_at)) || !Number.isFinite(Date.parse(outcome.completed_at)) ||
      Date.parse(outcome.completed_at) < Date.parse(outcome.started_at) ||
      !Number.isInteger(outcome.duration_ms) || outcome.duration_ms < 0 || !Array.isArray(outcome.gates) || outcome.gates.length > 500) {
    reject('Verification outcome envelope is invalid.');
  }
  const gateIds = new Set();
  for (const gate of outcome.gates) {
    const gateKeys = ['target_id', 'gate_id', 'capabilities', 'enforcement', 'command', 'cwd', 'subject_sha',
      'duration_ms', 'exit_code', 'result', 'reason', 'report_sha256'];
    if (gate === null || typeof gate !== 'object' || Array.isArray(gate) ||
        JSON.stringify(Object.keys(gate).sort()) !== JSON.stringify(gateKeys.sort()) || !ID.test(gate.target_id) || !ID.test(gate.gate_id) ||
        !Array.isArray(gate.capabilities) || gate.capabilities.length === 0 || gate.capabilities.length > 20 ||
        new Set(gate.capabilities).size !== gate.capabilities.length || gate.capabilities.some((item) => !CAPABILITIES.has(item)) ||
        !['required', 'advisory'].includes(gate.enforcement) || typeof gate.cwd !== 'string' || !gate.cwd || path.isAbsolute(gate.cwd) ||
        gate.cwd.length > 200 || gate.cwd.split(/[\\/]/u).includes('..') ||
        !SHA.test(gate.subject_sha) || gate.subject_sha !== outcome.subject_sha || !Number.isInteger(gate.duration_ms) || gate.duration_ms < 0 ||
        !GATE_RESULTS.has(gate.result) || (gate.exit_code !== null && !Number.isInteger(gate.exit_code)) ||
        (gate.reason !== null && (typeof gate.reason !== 'string' || gate.reason.length > 100)) ||
        (gate.report_sha256 !== null && !SHA256.test(gate.report_sha256)) ||
        (gate.command !== null && (typeof gate.command !== 'object' || Array.isArray(gate.command) ||
          JSON.stringify(Object.keys(gate.command).sort()) !== JSON.stringify(['args', 'executable']) ||
          typeof gate.command.executable !== 'string' || !Array.isArray(gate.command.args)))) {
      reject('Verification gate outcome is invalid.');
    }
    if (gate.command !== null) {
      try { assertSafeVerificationCommand(gate.command); } catch { reject('Verification gate command is outside the closed policy.'); }
    }
    const identity = `${gate.target_id}\0${gate.gate_id}`;
    if (gateIds.has(identity)) reject('Verification outcome contains a duplicate gate identity.');
    gateIds.add(identity);
    if (gate.result === 'passed' && (gate.exit_code !== 0 || gate.reason !== null) ||
        ['not_configured', 'not_run', 'skipped'].includes(gate.result) && gate.exit_code !== null ||
        gate.result === 'not_configured' && gate.command !== null ||
        gate.result !== 'not_configured' && gate.command === null) reject('Verification gate result semantics are invalid.');
  }
  if (outcome.result !== deriveResult(outcome.gates)) reject('Verification outcome result does not match its gate results.');
  if (expectedPlan !== null) {
    if (outcome.plan_sha256 !== hashJson(expectedPlan) || outcome.subject_sha !== expectedPlan.subject_sha ||
        outcome.base_sha !== expectedPlan.base_sha || outcome.dispatch !== expectedPlan.dispatch) reject('Verification outcome does not match the trusted plan envelope.');
    const expected = expectedPlan.targets.filter(({ required }) => required)
      .flatMap((target) => target.gates.map((gate) => ({ target, gate })));
    if (expected.length !== outcome.gates.length) reject('Verification outcome gate set does not match the trusted plan.');
    for (let index = 0; index < expected.length; index += 1) {
      const planned = expected[index];
      const actual = outcome.gates[index];
      if (actual.target_id !== planned.target.id || actual.gate_id !== planned.gate.id || actual.cwd !== planned.gate.cwd ||
          actual.enforcement !== planned.gate.enforcement || JSON.stringify(actual.capabilities) !== JSON.stringify(planned.gate.capabilities) ||
          JSON.stringify(actual.command) !== JSON.stringify(planned.gate.command)) reject('Verification outcome gate metadata does not match the trusted plan.');
    }
  }
  return outcome;
}

export function writeVerificationOutcome(repoRoot, outputPath, outcome, expectedPlan) {
  validateVerificationOutcome(outcome, expectedPlan);
  const trustedRoot = realpathSync(repoRoot);
  const destination = path.resolve(trustedRoot, outputPath);
  if (!within(trustedRoot, destination) || existsSync(destination)) reject('Outcome path must be a new repository-contained file.');
  const relative = path.relative(trustedRoot, destination).replaceAll('\\', '/');
  if (!relative.startsWith('artifacts/verification-outcomes/') || !/^[A-Za-z0-9._/-]+\.json$/u.test(relative)) {
    reject('Outcome path must use the artifacts/verification-outcomes JSON namespace.');
  }
  const parent = path.dirname(destination);
  if (!existsSync(parent) || !lstatSync(parent).isDirectory()) reject('Outcome parent directory must already exist.');
  let cursor = trustedRoot;
  for (const segment of path.relative(trustedRoot, parent).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) reject('Outcome path cannot contain a link or reparse component.');
  }
  if (!within(trustedRoot, realpathSync(parent)) && pathKey(realpathSync(parent)) !== pathKey(trustedRoot)) reject('Outcome parent escaped the repository.');
  const json = `${JSON.stringify(outcome, null, 2)}\n`;
  if (Buffer.byteLength(json) > 4 * 1024 * 1024) reject('Outcome exceeds the size limit.');
  writeFileSync(destination, json, { encoding: 'utf8', flag: 'wx' });
  return relative;
}
