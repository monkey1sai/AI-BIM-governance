import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { validateOpenSpecLifecycleLedger } from './openspec-machine-truth.mjs';
import { validateTaskPacketCorpus } from './task-packet.mjs';

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const DAY_MS = 86_400_000;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_REPORT_INPUT_BYTES = 16 * 1024 * 1024;
const BASELINE_STARTED_ON = '2026-07-28';
const POLICY_KEYS = ['schema_version', 'authority', 'baseline', 'retention', 'merge_truth', 'diagnostic_retry', 'privacy', 'registry', 'metrics'];
const ENVELOPE_KEYS = ['schema_version', 'authority', 'observed_at', 'subject_sha', 'plan_sha256', 'manifest_sha256',
  'ref_class', 'package_id', 'environment_class', 'toolchain_sha256', 'retry_of_sha256', 'records'];
const RECORD_KEYS = ['gate_id', 'test_id', 'attempt', 'retry_of', 'duration_ms', 'timeout_ms', 'result', 'exit_code',
  'trace_sha256', 'trace_size_bytes'];
const TELEMETRY_ARTIFACT_KEYS = ['artifact_path', 'artifact_sha256', 'size_bytes', 'document'];
const METRIC_IDS = [
  'first-pass-gate-yield', 'change-to-fast-check-ms', 'rework-commit-count', 'active-change-wip',
  'active-change-age-days', 'context-packet-size', 'flake-rate',
];
const REJECTION_REASONS = [
  'historical_backfill_forbidden', 'outside_window', 'future_timestamp', 'invalid_contract',
  'duplicate_observation', 'missing_attempt_one', 'retry_mismatch',
];
const EXPECTED_ENVELOPE_FIELDS = [...ENVELOPE_KEYS].sort();
const EXPECTED_RECORD_FIELDS = [...RECORD_KEYS].sort();
const EXPECTED_FORBIDDEN_FIELDS = [
  'actor', 'args', 'command', 'cwd', 'env', 'hostname', 'log', 'message', 'path', 'prompt', 'repository', 'session',
  'source', 'stack', 'stderr', 'stdout', 'url', 'user',
];
const TRUSTED_TEST_IDENTITIES = new Set([
  registryKey('root-governance', 'agent-governance-tests', 'governance-contracts'),
  registryKey('coordinator', 'coordinator-verify', 'full-verify'),
  registryKey('viewer', 'viewer-verify', 'full-verify'),
]);
const TRUSTED_PACKAGE_IDS = new Set(['root-governance', 'coordinator', 'viewer']);
const TRUSTED_TELEMETRY_ARTIFACTS = new WeakMap();
const TRUSTED_JSON_INPUTS = new WeakMap();
const BUILT_REPORTS = new WeakMap();

export class AiCodingMetricsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AiCodingMetricsError';
    this.code = code;
  }
}

function fail(code, message) { throw new AiCodingMetricsError(code, message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys, label) {
  if (!isObject(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail('invalid_contract', `${label} has missing or unknown fields.`);
  }
}
function exactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify([...value].sort()) !== JSON.stringify([...expected].sort())) {
    fail('invalid_contract', `${label} does not match the closed field policy.`);
  }
}
function validTimestamp(value) {
  return typeof value === 'string' && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}
function registryKey(packageId, gateId, testId) { return `${packageId}\0${gateId}\0${testId}`; }
function observationKey(value) {
  const attempt = value.records[0].attempt;
  return [value.subject_sha, value.plan_sha256, value.manifest_sha256, value.ref_class, value.package_id,
    value.environment_class, value.toolchain_sha256, attempt].join('\0');
}
function pairKey(value) {
  return [value.subject_sha, value.plan_sha256, value.manifest_sha256, value.ref_class, value.package_id,
    value.environment_class, value.toolchain_sha256].join('\0');
}
function pathKey(value) { return process.platform === 'win32' ? value.toLowerCase() : value; }
function within(root, candidate, allowEqual = false) {
  const left = pathKey(path.resolve(root));
  const right = pathKey(path.resolve(candidate));
  return (allowEqual && left === right) || right.startsWith(`${left}${path.sep}`);
}
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
function ratio(numerator, denominator) { return denominator === 0 ? null : Number((numerator / denominator).toFixed(6)); }
function canonicalObservationBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha256Bytes(value) { return createHash('sha256').update(value).digest('hex'); }
function objectDigest(value) { return sha256Bytes(Buffer.from(JSON.stringify(value), 'utf8')); }
function isDigestBound(store, value) { return isObject(value) && store.get(value) === objectDigest(value); }
function telemetryArtifactPath(value) {
  const attempt = value.records[0].attempt;
  return `artifacts/telemetry/ai-coding/${value.subject_sha}/${value.package_id}/attempt-${attempt}.json`;
}

export function validateAiCodingMetricsPolicy(policy) {
  exactKeys(policy, POLICY_KEYS, 'policy');
  if (policy.schema_version !== 'ai-coding-metrics-policy/v1' || policy.authority !== 'telemetry_only') {
    fail('invalid_contract', 'Policy authority or version is invalid.');
  }
  exactKeys(policy.baseline, ['started_on', 'minimum_days', 'historical_backfill', 'capture_provenance', 'readiness_gate', 'improvement_targets'], 'policy.baseline');
  if (policy.baseline.started_on !== BASELINE_STARTED_ON || policy.baseline.minimum_days !== 28 ||
      policy.baseline.historical_backfill !== 'forbidden' || policy.baseline.capture_provenance !== 'unattested' ||
      policy.baseline.readiness_gate !== 'hosted-attested-capture-required' || policy.baseline.improvement_targets !== null) {
    fail('invalid_contract', 'Baseline must remain an unattested 28-day no-backfill policy with no target.');
  }
  exactKeys(policy.retention, ['raw_observations_days', 'monthly_aggregate_identity', 'enforcement', 'not_configured_reason'], 'policy.retention');
  if (policy.retention.raw_observations_days !== 35 || policy.retention.monthly_aggregate_identity !== 'package_only' ||
      policy.retention.enforcement !== 'not_configured' || policy.retention.not_configured_reason !== 'hosted-retention-unverified') {
    fail('invalid_contract', 'Retention must remain a 35-day hosted-unverified policy with package-only aggregation.');
  }
  exactKeys(policy.merge_truth, ['required_retry_count', 'telemetry_is_merge_authority'], 'policy.merge_truth');
  if (policy.merge_truth.required_retry_count !== 0 || policy.merge_truth.telemetry_is_merge_authority !== false) {
    fail('invalid_contract', 'Merge truth cannot retry or consume telemetry.');
  }
  exactKeys(policy.diagnostic_retry, ['enabled', 'maximum_retries', 'raw_trace_storage'], 'policy.diagnostic_retry');
  if (policy.diagnostic_retry.enabled !== true || policy.diagnostic_retry.maximum_retries !== 1 ||
      policy.diagnostic_retry.raw_trace_storage !== 'forbidden') {
    fail('invalid_contract', 'Diagnostic retry must remain one telemetry-only retry without raw traces.');
  }
  exactKeys(policy.privacy, ['stored_envelope_fields', 'stored_record_fields', 'forbidden_fields'], 'policy.privacy');
  exactArray(policy.privacy.stored_envelope_fields, EXPECTED_ENVELOPE_FIELDS, 'policy.privacy.stored_envelope_fields');
  exactArray(policy.privacy.stored_record_fields, EXPECTED_RECORD_FIELDS, 'policy.privacy.stored_record_fields');
  exactArray(policy.privacy.forbidden_fields, EXPECTED_FORBIDDEN_FIELDS, 'policy.privacy.forbidden_fields');
  if (!Array.isArray(policy.registry) || policy.registry.length === 0 || policy.registry.length > 20) {
    fail('invalid_contract', 'Policy registry must be bounded and non-empty.');
  }
  const registry = new Set();
  for (const [index, item] of policy.registry.entries()) {
    exactKeys(item, ['package_id', 'gate_id', 'test_ids'], `policy.registry[${index}]`);
    if (!ID.test(item.package_id) || !ID.test(item.gate_id) || !Array.isArray(item.test_ids) || item.test_ids.length === 0 ||
        item.test_ids.length > 20 || item.test_ids.some((value) => !ID.test(value)) || new Set(item.test_ids).size !== item.test_ids.length) {
      fail('invalid_contract', 'Policy registry contains an invalid identifier.');
    }
    for (const testId of item.test_ids) {
      const key = registryKey(item.package_id, item.gate_id, testId);
      if (registry.has(key)) fail('invalid_contract', 'Policy registry contains a duplicate test identity.');
      registry.add(key);
    }
  }
  if (registry.size !== TRUSTED_TEST_IDENTITIES.size || [...registry].some((key) => !TRUSTED_TEST_IDENTITIES.has(key))) {
    fail('invalid_contract', 'Policy registry must match the closed repository test registry.');
  }
  if (!Array.isArray(policy.metrics) || policy.metrics.length !== METRIC_IDS.length) {
    fail('invalid_contract', 'Policy must declare the complete metric set.');
  }
  const metricById = new Map();
  for (const item of policy.metrics) {
    exactKeys(item, ['id', 'state', 'reason'], 'policy.metrics[]');
    if (!METRIC_IDS.includes(item.id) || metricById.has(item.id) || !['collecting_baseline', 'snapshot_only', 'not_configured'].includes(item.state) ||
        !ID.test(item.reason)) fail('invalid_contract', 'Policy metric declaration is invalid.');
    metricById.set(item.id, item);
  }
  const expectedStates = {
    'first-pass-gate-yield': 'collecting_baseline', 'change-to-fast-check-ms': 'not_configured',
    'rework-commit-count': 'not_configured', 'active-change-wip': 'snapshot_only',
    'active-change-age-days': 'not_configured', 'context-packet-size': 'snapshot_only', 'flake-rate': 'collecting_baseline',
  };
  for (const [id, state] of Object.entries(expectedStates)) {
    if (metricById.get(id)?.state !== state) fail('invalid_contract', `Metric ${id} has the wrong policy state.`);
  }
  return { registry, metricById };
}

export function validateTelemetryObservation(observation, policy) {
  const { registry } = validateAiCodingMetricsPolicy(policy);
  exactKeys(observation, ENVELOPE_KEYS, 'observation');
  if (observation.schema_version !== 'ai-coding-telemetry-observation/v1' || observation.authority !== 'telemetry_only' ||
      !validTimestamp(observation.observed_at) || !SHA.test(observation.subject_sha) || !SHA256.test(observation.plan_sha256) ||
      !SHA256.test(observation.manifest_sha256) || !['pull_request', 'main', 'manual'].includes(observation.ref_class) ||
      !ID.test(observation.package_id) || !['github-hosted-windows', 'local-windows', 'host-native-windows'].includes(observation.environment_class) ||
      !SHA256.test(observation.toolchain_sha256) || !Array.isArray(observation.records) || observation.records.length === 0 ||
      observation.records.length > 500) fail('invalid_contract', 'Telemetry observation envelope is invalid.');
  const identities = new Set();
  let artifactAttempt = null;
  for (const [index, record] of observation.records.entries()) {
    exactKeys(record, RECORD_KEYS, `observation.records[${index}]`);
    if (!ID.test(record.gate_id) || !ID.test(record.test_id) || ![1, 2].includes(record.attempt) ||
        !Number.isInteger(record.duration_ms) || record.duration_ms < 0 ||
        !Number.isInteger(record.timeout_ms) || record.timeout_ms < 1_000 || record.timeout_ms > 3_600_000 ||
        record.duration_ms > record.timeout_ms + 5_000 || !['passed', 'failed', 'timed_out'].includes(record.result) ||
        !registry.has(registryKey(observation.package_id, record.gate_id, record.test_id))) {
      fail('invalid_contract', 'Telemetry record contains an untrusted identity or value.');
    }
    if (record.attempt === 1 && record.retry_of !== null || record.attempt === 2 && record.retry_of !== 1 ||
        record.result === 'passed' && record.exit_code !== 0 || record.result === 'failed' && (!Number.isInteger(record.exit_code) || record.exit_code === 0) ||
        record.result === 'timed_out' && record.exit_code !== null ||
        (record.trace_sha256 === null) !== (record.trace_size_bytes === null) ||
        (record.trace_sha256 !== null && (!SHA256.test(record.trace_sha256) || !Number.isInteger(record.trace_size_bytes) ||
          record.trace_size_bytes < 0 || record.trace_size_bytes > 1_073_741_824))) {
      fail('invalid_contract', 'Telemetry result, retry, or trace semantics are invalid.');
    }
    if (artifactAttempt === null) artifactAttempt = record.attempt;
    if (artifactAttempt !== record.attempt) fail('invalid_contract', 'One telemetry artifact can contain only one attempt.');
    const identity = `${record.gate_id}\0${record.test_id}`;
    if (identities.has(identity)) fail('invalid_contract', 'Telemetry artifact contains a duplicate test identity.');
    identities.add(identity);
  }
  if (artifactAttempt === 2 && (!policy.diagnostic_retry.enabled || policy.diagnostic_retry.maximum_retries !== 1)) {
    fail('invalid_contract', 'Retry telemetry is disabled.');
  }
  if (artifactAttempt === 1 && observation.retry_of_sha256 !== null ||
      artifactAttempt === 2 && !SHA256.test(observation.retry_of_sha256 ?? '')) {
    fail('invalid_contract', 'Telemetry retry digest does not match the artifact attempt.');
  }
  return observation;
}

export function validateTelemetryRetryPair(first, retry, policy, firstArtifactSha256) {
  validateTelemetryObservation(first, policy);
  validateTelemetryObservation(retry, policy);
  if (first.records[0].attempt !== 1 || retry.records[0].attempt !== 2 || pairKey(first) !== pairKey(retry) ||
      !SHA256.test(firstArtifactSha256 ?? '') || retry.retry_of_sha256 !== firstArtifactSha256 ||
      sha256Bytes(canonicalObservationBytes(first)) !== firstArtifactSha256 ||
      Date.parse(retry.observed_at) <= Date.parse(first.observed_at)) {
    fail('retry_mismatch', 'Retry does not match its immutable first attempt.');
  }
  const firstByTest = new Map(first.records.map((item) => [`${item.gate_id}\0${item.test_id}`, item]));
  for (const item of retry.records) {
    const original = firstByTest.get(`${item.gate_id}\0${item.test_id}`);
    if (!original || original.attempt !== 1 || !['failed', 'timed_out'].includes(original.result)) {
      fail('retry_mismatch', 'Retry may include only failed or timed-out first-attempt tests.');
    }
  }
  return retry;
}

function ensureArtifactParent(repoRoot, segments) {
  let cursor = repoRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (existsSync(cursor)) {
      const item = lstatSync(cursor);
      if (!item.isDirectory() || item.isSymbolicLink()) fail('artifact_path_invalid', 'Artifact parent contains an unsafe component.');
    } else mkdirSync(cursor);
  }
  return cursor;
}

export function writeTelemetryObservation(repoRoot, outputPath, observation, policy) {
  validateTelemetryObservation(observation, policy);
  const trustedRoot = realpathSync(repoRoot);
  const attempt = observation.records[0].attempt;
  const expected = telemetryArtifactPath(observation);
  const normalized = outputPath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized !== expected) fail('artifact_path_invalid', 'Telemetry output path does not match its trusted identity.');
  ensureArtifactParent(trustedRoot, ['artifacts', 'telemetry', 'ai-coding', observation.subject_sha, observation.package_id]);
  const destination = path.resolve(trustedRoot, normalized);
  if (!within(trustedRoot, destination) || existsSync(destination)) fail('artifact_path_invalid', 'Telemetry output must be a new repository-contained file.');
  if (attempt === 2) {
    const firstPath = path.join(path.dirname(destination), 'attempt-1.json');
    const first = readBoundedJsonDocument(trustedRoot, firstPath, 'first_attempt');
    const canonical = canonicalObservationBytes(first.value);
    if (!first.bytes.equals(canonical)) fail('retry_mismatch', 'First attempt is not a canonical recorder artifact.');
    validateTelemetryRetryPair(first.value, observation, policy, sha256Bytes(first.bytes));
  }
  const bytes = canonicalObservationBytes(observation);
  if (bytes.length > MAX_ARTIFACT_BYTES) fail('artifact_too_large', 'Telemetry artifact exceeds 1 MiB.');
  writeFileSync(destination, bytes, { flag: 'wx' });
  return normalized;
}

function readBoundedJsonDocument(repoRoot, inputPath, label = 'input') {
  const trustedRoot = realpathSync(repoRoot);
  const candidate = path.resolve(trustedRoot, inputPath);
  if (!within(trustedRoot, candidate) || !existsSync(candidate)) fail('input_untrusted', `${label} is outside the repository or missing.`);
  let cursor = trustedRoot;
  for (const segment of path.relative(trustedRoot, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    const item = lstatSync(cursor);
    if (item.isSymbolicLink()) fail('input_untrusted', `${label} contains a link or reparse component.`);
  }
  const item = lstatSync(candidate);
  if (!item.isFile() || item.size > MAX_ARTIFACT_BYTES || !within(trustedRoot, realpathSync(candidate))) {
    fail('input_untrusted', `${label} must be a bounded repository file.`);
  }
  const bytes = readFileSync(candidate);
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes, candidate, trustedRoot };
  } catch {
    fail('invalid_contract', `${label} is not valid UTF-8 JSON.`);
  }
}

export function readBoundedJson(repoRoot, inputPath, label = 'input') {
  const value = readBoundedJsonDocument(repoRoot, inputPath, label).value;
  if (isObject(value)) TRUSTED_JSON_INPUTS.set(value, objectDigest(value));
  return value;
}

export function validateTelemetryArtifact(artifact, policy) {
  exactKeys(artifact, TELEMETRY_ARTIFACT_KEYS, 'telemetry_artifact');
  validateTelemetryObservation(artifact.document, policy);
  const bytes = canonicalObservationBytes(artifact.document);
  if (artifact.artifact_path !== telemetryArtifactPath(artifact.document) || !SHA256.test(artifact.artifact_sha256) ||
      artifact.artifact_sha256 !== sha256Bytes(bytes) || !Number.isInteger(artifact.size_bytes) ||
      artifact.size_bytes !== bytes.length || artifact.size_bytes > MAX_ARTIFACT_BYTES) {
    fail('invalid_contract', 'Telemetry artifact path, digest, or size is invalid.');
  }
  return artifact;
}

export function readTelemetryArtifact(repoRoot, inputPath, policy) {
  const input = readBoundedJsonDocument(repoRoot, inputPath, 'telemetry_artifact');
  const relative = path.relative(input.trustedRoot, input.candidate).replaceAll('\\', '/');
  const canonical = canonicalObservationBytes(input.value);
  if (!input.bytes.equals(canonical)) fail('input_untrusted', 'Telemetry artifact is not in canonical recorder form.');
  const artifact = validateTelemetryArtifact({
    artifact_path: relative,
    artifact_sha256: sha256Bytes(input.bytes),
    size_bytes: input.bytes.length,
    document: input.value,
  }, policy);
  TRUSTED_TELEMETRY_ARTIFACTS.set(artifact, objectDigest(artifact));
  return artifact;
}

function metric(id, status, value, unit, sampleSize, reason) {
  return { id, status, value, unit, sample_size: sampleSize, reason };
}

export function buildAiCodingMetricsReport({ policy, generatedAt, observations = [], lifecycleLedger = null, taskPacketCorpus = null }) {
  validateAiCodingMetricsPolicy(policy);
  if (!validTimestamp(generatedAt) || !Array.isArray(observations) || observations.length > 500 ||
      observations.reduce((total, item) => total + (Number.isInteger(item?.size_bytes) ? item.size_bytes : 0), 0) > MAX_REPORT_INPUT_BYTES) {
    fail('invalid_contract', 'Metrics report inputs are invalid.');
  }
  const generatedMs = Date.parse(generatedAt);
  const baselineMs = Date.parse(`${policy.baseline.started_on}T00:00:00.000Z`);
  if (generatedMs < baselineMs) fail('invalid_contract', 'Report cannot predate the baseline.');
  const windowStartMs = Math.max(baselineMs, generatedMs - policy.baseline.minimum_days * DAY_MS);
  const rejectionCounts = new Map(REJECTION_REASONS.map((reason) => [reason, 0]));
  const candidates = [];
  const seen = new Set();
  for (const raw of observations) {
    let artifact;
    let value;
    try {
      artifact = validateTelemetryArtifact(raw, policy);
      value = artifact.document;
    }
    catch { rejectionCounts.set('invalid_contract', rejectionCounts.get('invalid_contract') + 1); continue; }
    const observedMs = Date.parse(value.observed_at);
    let reason = null;
    if (observedMs < baselineMs) reason = 'historical_backfill_forbidden';
    else if (observedMs < windowStartMs) reason = 'outside_window';
    else if (observedMs > generatedMs + 5 * 60_000) reason = 'future_timestamp';
    const key = observationKey(value);
    if (reason === null && seen.has(key)) reason = 'duplicate_observation';
    if (reason !== null) { rejectionCounts.set(reason, rejectionCounts.get(reason) + 1); continue; }
    seen.add(key);
    candidates.push(artifact);
  }
  const firstByPair = new Map(candidates.filter(({ document }) => document.records[0].attempt === 1)
    .map((artifact) => [pairKey(artifact.document), artifact]));
  const accepted = [];
  for (const artifact of candidates) {
    const value = artifact.document;
    if (value.records[0].attempt === 1) { accepted.push(artifact); continue; }
    const first = firstByPair.get(pairKey(value));
    if (!first) { rejectionCounts.set('missing_attempt_one', rejectionCounts.get('missing_attempt_one') + 1); continue; }
    try { validateTelemetryRetryPair(first.document, value, policy, first.artifact_sha256); accepted.push(artifact); }
    catch { rejectionCounts.set('retry_mismatch', rejectionCounts.get('retry_mismatch') + 1); }
  }
  const attemptsOne = accepted.filter(({ document }) => document.records[0].attempt === 1);
  const attemptsTwo = new Map(accepted.filter(({ document }) => document.records[0].attempt === 2)
    .map((artifact) => [pairKey(artifact.document), artifact.document]));
  const firstRecords = attemptsOne.flatMap(({ document }) => document.records.map((record) => ({ envelope: document, record })));
  const passedFirst = firstRecords.filter(({ record }) => record.result === 'passed').length;
  let flaky = 0;
  for (const { envelope, record } of firstRecords) {
    if (!['failed', 'timed_out'].includes(record.result)) continue;
    const retry = attemptsTwo.get(pairKey(envelope));
    if (retry?.records.some((item) => item.gate_id === record.gate_id && item.test_id === record.test_id && item.result === 'passed')) flaky += 1;
  }
  const elapsedDays = Math.floor((generatedMs - baselineMs) / DAY_MS);
  const baselinePhase = 'baseline_provenance_unverified';
  const observedStatus = firstRecords.length === 0 ? 'no_observations' : 'collecting_baseline';
  let activeCount = null;
  if (lifecycleLedger !== null) {
    try {
      validateOpenSpecLifecycleLedger(lifecycleLedger);
      activeCount = lifecycleLedger.changes.filter((item) => item.status === 'active').length;
    } catch { activeCount = null; }
  }
  let contextMedian = null;
  if (taskPacketCorpus !== null) {
    try {
      validateTaskPacketCorpus(taskPacketCorpus);
      contextMedian = median(taskPacketCorpus.tasks.map((packet) => packet.read_set.length));
    } catch { contextMedian = null; }
  }
  const metrics = [
    metric('first-pass-gate-yield', observedStatus, ratio(passedFirst, firstRecords.length), 'ratio', firstRecords.length,
      firstRecords.length === 0 ? 'no-observations' : 'baseline-provenance-unverified'),
    metric('change-to-fast-check-ms', 'not_configured', null, 'milliseconds', 0, 'first-change-timestamp-unavailable'),
    metric('rework-commit-count', 'not_configured', null, 'count', 0, 'work-item-rework-link-unavailable'),
    metric('active-change-wip', activeCount === null ? 'not_configured' : 'snapshot_only', activeCount, 'count', activeCount === null ? 0 : 1,
      activeCount === null ? 'lifecycle-snapshot-unavailable' : 'lifecycle-current-state-only'),
    metric('active-change-age-days', 'not_configured', null, 'days', 0, 'active-start-timestamp-unavailable'),
    metric('context-packet-size', contextMedian === null ? 'not_configured' : 'snapshot_only', contextMedian, 'declared_read_set_entries',
      contextMedian === null ? 0 : taskPacketCorpus.tasks.length, contextMedian === null ? 'task-packet-snapshot-unavailable' : 'declared-corpus-snapshot-only'),
    metric('flake-rate', observedStatus, ratio(flaky, firstRecords.length), 'ratio', firstRecords.length,
      firstRecords.length === 0 ? 'no-observations' : 'baseline-provenance-unverified'),
  ];
  const packageIds = [...new Set(attemptsOne.map(({ document }) => document.package_id))].sort((a, b) => a.localeCompare(b, 'en'));
  const packages = packageIds.map((packageId) => {
    const records = firstRecords.filter(({ envelope }) => envelope.package_id === packageId);
    const packagePassed = records.filter(({ record }) => record.result === 'passed').length;
    let packageFlaky = 0;
    for (const { envelope, record } of records) {
      const retry = attemptsTwo.get(pairKey(envelope));
      if (['failed', 'timed_out'].includes(record.result) && retry?.records.some((item) =>
        item.gate_id === record.gate_id && item.test_id === record.test_id && item.result === 'passed')) packageFlaky += 1;
    }
    return {
      package_id: packageId,
      sample_size: records.length,
      first_pass_gate_yield: ratio(packagePassed, records.length),
      flake_rate: ratio(packageFlaky, records.length),
      attempt_one_duration_median_ms: median(records.map(({ record }) => record.duration_ms)),
    };
  });
  const rejections = REJECTION_REASONS.filter((reason) => rejectionCounts.get(reason) > 0)
    .map((reason) => ({ reason, count: rejectionCounts.get(reason) }));
  const report = {
    schema_version: 'ai-coding-metrics-report/v1',
    authority: 'telemetry_only',
    generated_at: generatedAt,
    window: {
      start: new Date(windowStartMs).toISOString(), end: generatedAt, days: policy.baseline.minimum_days,
      baseline_started_on: policy.baseline.started_on, elapsed_days: elapsedDays, phase: baselinePhase,
    },
    source_summary: {
      telemetry: { supplied: observations.length, accepted: accepted.length, rejected: observations.length - accepted.length, rejections },
      lifecycle_snapshot: activeCount === null ? 'not_available' : 'accepted',
      task_packet_snapshot: contextMedian === null ? 'not_available' : 'accepted',
    },
    metrics,
    packages,
    decision: {
      improvement_targets: null,
      monthly_comparison: null,
      reason: firstRecords.length === 0 ? 'no-observations' : 'baseline-provenance-unverified',
    },
  };
  validateAiCodingMetricsReport(report);
  BUILT_REPORTS.set(report, {
    source_bound: isDigestBound(TRUSTED_JSON_INPUTS, policy) &&
      observations.every((artifact) => isDigestBound(TRUSTED_TELEMETRY_ARTIFACTS, artifact)) &&
      (lifecycleLedger === null || isDigestBound(TRUSTED_JSON_INPUTS, lifecycleLedger)) &&
      (taskPacketCorpus === null || isDigestBound(TRUSTED_JSON_INPUTS, taskPacketCorpus)),
    report_digest: objectDigest(report),
  });
  return report;
}

export function validateAiCodingMetricsReport(report) {
  exactKeys(report, ['schema_version', 'authority', 'generated_at', 'window', 'source_summary', 'metrics', 'packages', 'decision'], 'report');
  if (report.schema_version !== 'ai-coding-metrics-report/v1' || report.authority !== 'telemetry_only' || !validTimestamp(report.generated_at)) {
    fail('invalid_contract', 'Metrics report envelope is invalid.');
  }
  exactKeys(report.window, ['start', 'end', 'days', 'baseline_started_on', 'elapsed_days', 'phase'], 'report.window');
  if (!validTimestamp(report.window.start) || report.window.end !== report.generated_at || report.window.days !== 28 ||
      report.window.baseline_started_on !== BASELINE_STARTED_ON || !Number.isInteger(report.window.elapsed_days) || report.window.elapsed_days < 0 ||
      report.window.phase !== 'baseline_provenance_unverified') fail('invalid_contract', 'Metrics report window is invalid or claims unattested readiness.');
  exactKeys(report.source_summary, ['telemetry', 'lifecycle_snapshot', 'task_packet_snapshot'], 'report.source_summary');
  exactKeys(report.source_summary.telemetry, ['supplied', 'accepted', 'rejected', 'rejections'], 'report.source_summary.telemetry');
  const source = report.source_summary.telemetry;
  if (![source.supplied, source.accepted, source.rejected].every((value) => Number.isInteger(value) && value >= 0) ||
      source.accepted + source.rejected !== source.supplied || !Array.isArray(source.rejections) ||
      !['accepted', 'not_available'].includes(report.source_summary.lifecycle_snapshot) ||
      !['accepted', 'not_available'].includes(report.source_summary.task_packet_snapshot)) fail('invalid_contract', 'Metrics report source summary is invalid.');
  let rejected = 0;
  const rejectionIds = new Set();
  for (const item of source.rejections) {
    exactKeys(item, ['reason', 'count'], 'report.source_summary.telemetry.rejections[]');
    if (!REJECTION_REASONS.includes(item.reason) || rejectionIds.has(item.reason) || !Number.isInteger(item.count) || item.count < 1) {
      fail('invalid_contract', 'Metrics report rejection is invalid.');
    }
    rejectionIds.add(item.reason); rejected += item.count;
  }
  if (rejected !== source.rejected) fail('invalid_contract', 'Metrics report rejection counts do not reconcile.');
  if (!Array.isArray(report.metrics) || report.metrics.length !== METRIC_IDS.length) fail('invalid_contract', 'Metrics report metric set is incomplete.');
  const metricIds = new Set();
  const metricsById = new Map();
  for (const item of report.metrics) {
    exactKeys(item, ['id', 'status', 'value', 'unit', 'sample_size', 'reason'], 'report.metrics[]');
    if (!METRIC_IDS.includes(item.id) || metricIds.has(item.id) ||
        !['collecting_baseline', 'snapshot_only', 'not_configured', 'no_observations'].includes(item.status) ||
        (item.value !== null && (typeof item.value !== 'number' || !Number.isFinite(item.value) || item.value < 0)) ||
        !['ratio', 'milliseconds', 'count', 'days', 'declared_read_set_entries'].includes(item.unit) ||
        !Number.isInteger(item.sample_size) || item.sample_size < 0 || !ID.test(item.reason) ||
        (item.sample_size === 0 && item.value !== null) || (item.status === 'no_observations' && item.value !== null)) {
      fail('invalid_contract', 'Metrics report metric value is invalid.');
    }
    metricIds.add(item.id);
    metricsById.set(item.id, item);
  }
  if (!Array.isArray(report.packages) || report.packages.length > 20) fail('invalid_contract', 'Metrics report package aggregates are invalid.');
  const packageIds = new Set();
  for (const item of report.packages) {
    exactKeys(item, ['package_id', 'sample_size', 'first_pass_gate_yield', 'flake_rate', 'attempt_one_duration_median_ms'], 'report.packages[]');
    if (!TRUSTED_PACKAGE_IDS.has(item.package_id) || packageIds.has(item.package_id) || !Number.isInteger(item.sample_size) || item.sample_size < 1 ||
        [item.first_pass_gate_yield, item.flake_rate].some((value) => typeof value !== 'number' || value < 0 || value > 1) ||
        typeof item.attempt_one_duration_median_ms !== 'number' || item.attempt_one_duration_median_ms < 0) {
      fail('invalid_contract', 'Metrics report package aggregate is invalid.');
    }
    packageIds.add(item.package_id);
  }
  const expectedUnits = new Map([
    ['first-pass-gate-yield', 'ratio'], ['change-to-fast-check-ms', 'milliseconds'], ['rework-commit-count', 'count'],
    ['active-change-wip', 'count'], ['active-change-age-days', 'days'], ['context-packet-size', 'declared_read_set_entries'],
    ['flake-rate', 'ratio'],
  ]);
  for (const [id, unit] of expectedUnits) {
    if (metricsById.get(id)?.unit !== unit) fail('invalid_contract', `Metric ${id} has the wrong unit.`);
  }
  const firstPass = metricsById.get('first-pass-gate-yield');
  const flakeRate = metricsById.get('flake-rate');
  const packageSampleSize = report.packages.reduce((total, item) => total + item.sample_size, 0);
  if (firstPass.sample_size !== flakeRate.sample_size || packageSampleSize !== firstPass.sample_size ||
      (source.accepted === 0 && (report.packages.length !== 0 || firstPass.status !== 'no_observations' || flakeRate.status !== 'no_observations' ||
        firstPass.value !== null || flakeRate.value !== null || firstPass.sample_size !== 0)) ||
      (source.accepted > 0 && (report.packages.length === 0 || firstPass.status !== 'collecting_baseline' || flakeRate.status !== 'collecting_baseline' ||
        firstPass.value === null || flakeRate.value === null || firstPass.sample_size === 0 || source.accepted < report.packages.length))) {
    fail('invalid_contract', 'Metrics report observations do not reconcile with global and package aggregates.');
  }
  if ((firstPass.value !== null && firstPass.value > 1) || (flakeRate.value !== null && flakeRate.value > 1)) {
    fail('invalid_contract', 'Ratio metrics must stay between zero and one.');
  }
  const weightedYield = ratio(report.packages.reduce((total, item) => total + item.first_pass_gate_yield * item.sample_size, 0), packageSampleSize);
  const weightedFlake = ratio(report.packages.reduce((total, item) => total + item.flake_rate * item.sample_size, 0), packageSampleSize);
  if (firstPass.value !== null &&
      (Math.abs(firstPass.value - weightedYield) > 0.000001 || Math.abs(flakeRate.value - weightedFlake) > 0.000001)) {
    fail('invalid_contract', 'Global ratios do not reconcile with package-only aggregates.');
  }
  for (const id of ['change-to-fast-check-ms', 'rework-commit-count', 'active-change-age-days']) {
    const item = metricsById.get(id);
    if (item.status !== 'not_configured' || item.value !== null || item.sample_size !== 0) {
      fail('invalid_contract', `${id} cannot claim an unavailable measurement.`);
    }
  }
  const wip = metricsById.get('active-change-wip');
  const context = metricsById.get('context-packet-size');
  if ((report.source_summary.lifecycle_snapshot === 'not_available' &&
      (wip.status !== 'not_configured' || wip.value !== null || wip.sample_size !== 0)) ||
      (report.source_summary.lifecycle_snapshot === 'accepted' &&
      (wip.status !== 'snapshot_only' || typeof wip.value !== 'number' || wip.sample_size !== 1))) {
    fail('invalid_contract', 'WIP metric does not match its lifecycle snapshot source.');
  }
  if ((report.source_summary.task_packet_snapshot === 'not_available' &&
      (context.status !== 'not_configured' || context.value !== null || context.sample_size !== 0)) ||
      (report.source_summary.task_packet_snapshot === 'accepted' &&
      (context.status !== 'snapshot_only' || typeof context.value !== 'number' || context.sample_size < 1))) {
    fail('invalid_contract', 'Context metric does not match its task-packet snapshot source.');
  }
  exactKeys(report.decision, ['improvement_targets', 'monthly_comparison', 'reason'], 'report.decision');
  if (report.decision.improvement_targets !== null || report.decision.monthly_comparison !== null ||
      !['no-observations', 'baseline-provenance-unverified'].includes(report.decision.reason) ||
      ((source.accepted === 0) !== (report.decision.reason === 'no-observations'))) {
    fail('invalid_contract', 'Metrics report cannot set a target or comparison before maintainer review.');
  }
  return report;
}

export function writeAiCodingMetricsReport(repoRoot, outputPath, report) {
  const provenance = BUILT_REPORTS.get(report);
  if (!provenance?.source_bound || provenance.report_digest !== objectDigest(report)) {
    fail('report_untrusted', 'Metrics report was not built unchanged from repository-bound sources.');
  }
  validateAiCodingMetricsReport(report);
  const trustedRoot = realpathSync(repoRoot);
  const date = report.generated_at.slice(0, 10);
  const expected = `artifacts/metrics/ai-coding/${date}.json`;
  const normalized = outputPath.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (normalized !== expected) fail('artifact_path_invalid', 'Metrics output path does not match its report date.');
  ensureArtifactParent(trustedRoot, ['artifacts', 'metrics', 'ai-coding']);
  const destination = path.resolve(trustedRoot, normalized);
  if (!within(trustedRoot, destination) || existsSync(destination)) fail('artifact_path_invalid', 'Metrics output must be a new repository-contained file.');
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(json) > MAX_ARTIFACT_BYTES) fail('artifact_too_large', 'Metrics artifact exceeds 1 MiB.');
  writeFileSync(destination, json, { encoding: 'utf8', flag: 'wx' });
  return normalized;
}

export function sha256Json(value) {
  return createHash('sha256').update(`${JSON.stringify(value)}\n`).digest('hex');
}
