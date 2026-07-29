import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildAiCodingMetricsReport,
  readBoundedJson,
  validateAiCodingMetricsPolicy,
  validateAiCodingMetricsReport,
  readTelemetryArtifact,
  validateTelemetryArtifact,
  validateTelemetryObservation,
  validateTelemetryRetryPair,
  writeAiCodingMetricsReport,
  writeTelemetryObservation,
} from '../lib/ai-coding-metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = readBoundedJson(root, 'scripts/ai-coding-metrics-policy.json', 'policy');
const ledger = JSON.parse(readFileSync(path.join(root, 'openspec', 'lifecycle-ledger.json'), 'utf8'));
const corpus = JSON.parse(readFileSync(path.join(root, 'scripts', 'tests', 'fixtures', 'agent-governance-routing.json'), 'utf8'));
// WIP 期望值由同一份 ledger 推導，不硬編碼：這兩個斷言驗的是「零觀測→null」與 held/completed
// 狀態處理，WIP 數字對其為附帶值；硬編碼會讓每次新增/封存 change 都誤觸紅燈。
// WIP 預算上限（≤6）的真正 gate 在 scripts/tests/verify-openspec-lifecycle.ps1，不在此檔。
const activeChangeCount = ledger.changes.filter((item) => item.status === 'active').length;

function observation({
  attempt = 1, result = 'passed', packageId = 'root-governance', gateId = 'agent-governance-tests',
  testId = 'governance-contracts', observedAt = '2026-07-29T12:00:00.000Z', environmentClass = 'github-hosted-windows',
  subject = 'a'.repeat(40), retryOfSha256 = 'f'.repeat(64),
} = {}) {
  return {
    schema_version: 'ai-coding-telemetry-observation/v1', authority: 'telemetry_only', observed_at: observedAt,
    subject_sha: subject, plan_sha256: 'b'.repeat(64), manifest_sha256: 'c'.repeat(64), ref_class: 'pull_request',
    package_id: packageId, environment_class: environmentClass, toolchain_sha256: 'd'.repeat(64),
    retry_of_sha256: attempt === 1 ? null : retryOfSha256,
    records: [{
      gate_id: gateId, test_id: testId, attempt, retry_of: attempt === 1 ? null : 1, duration_ms: 1250,
      timeout_ms: 30_000, result, exit_code: result === 'passed' ? 0 : (result === 'failed' ? 17 : null),
      trace_sha256: null, trace_size_bytes: null,
    }],
  };
}

function artifact(document) {
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return {
    artifact_path: `artifacts/telemetry/ai-coding/${document.subject_sha}/${document.package_id}/attempt-${document.records[0].attempt}.json`,
    artifact_sha256: createHash('sha256').update(bytes).digest('hex'),
    size_bytes: bytes.length,
    document,
  };
}

function metric(report, id) { return report.metrics.find((item) => item.id === id); }

test('canonical policy is strict, private, zero-retry merge truth', () => {
  validateAiCodingMetricsPolicy(policy);
  assert.equal(policy.merge_truth.required_retry_count, 0);
  assert.equal(policy.merge_truth.telemetry_is_merge_authority, false);
  assert.equal(policy.baseline.minimum_days, 28);
  assert.equal(policy.baseline.started_on, '2026-07-28');
  assert.equal(policy.baseline.capture_provenance, 'unattested');
  assert.equal(policy.baseline.improvement_targets, null);
  assert.equal(policy.retention.raw_observations_days, 35);
  assert.equal(policy.retention.enforcement, 'not_configured');
  assert.match(readFileSync(path.join(root, '.gitignore'), 'utf8'), /^artifacts\/telemetry\/ai-coding\/$/mu);
  const metricsDocs = readFileSync(path.join(root, 'docs', 'agents', 'ai-coding-metrics.md'), 'utf8');
  assert.match(metricsDocs, /--input artifacts\/telemetry\/ai-coding\/input\/observation\.json/u);
  assert.doesNotMatch(metricsDocs, /--input artifacts\/input\/observation\.json/u);
  for (const field of ['prompt', 'source', 'user', 'args', 'env', 'cwd', 'stdout', 'stderr', 'path']) {
    assert(policy.privacy.forbidden_fields.includes(field));
  }
});

test('no-backfill epoch is immutable in the runtime policy contract', () => {
  const backdated = structuredClone(policy);
  backdated.baseline.started_on = '2020-01-01';
  assert.throws(
    () => validateAiCodingMetricsPolicy(backdated),
    (error) => error?.code === 'invalid_contract',
  );
});

test('zero observations stay null while current WIP and declared packet size are typed snapshots', () => {
  const report = buildAiCodingMetricsReport({
    policy, generatedAt: '2026-07-30T12:00:00.000Z', lifecycleLedger: ledger, taskPacketCorpus: corpus,
  });
  validateAiCodingMetricsReport(report);
  assert.equal(metric(report, 'first-pass-gate-yield').status, 'no_observations');
  assert.equal(metric(report, 'first-pass-gate-yield').value, null);
  assert.equal(metric(report, 'flake-rate').value, null);
  assert.equal(metric(report, 'active-change-wip').value, activeChangeCount);
  assert.equal(metric(report, 'active-change-wip').status, 'snapshot_only');
  assert.equal(metric(report, 'context-packet-size').status, 'snapshot_only');
  assert.equal(metric(report, 'change-to-fast-check-ms').status, 'not_configured');
  assert.equal(report.decision.improvement_targets, null);
  assert.equal(report.decision.monthly_comparison, null);
  assert.equal(report.packages.length, 0);
});

test('WIP snapshot uses the full lifecycle ledger contract and supports held/completed states', () => {
  const heldLedger = structuredClone(ledger);
  const active = heldLedger.changes.find((item) => item.status === 'active');
  active.status = 'held';
  const heldReport = buildAiCodingMetricsReport({ policy, generatedAt: '2026-07-30T12:00:00.000Z', lifecycleLedger: heldLedger });
  assert.equal(metric(heldReport, 'active-change-wip').value, activeChangeCount - 1);

  for (const invalidLedger of [
    { schema_version: 'openspec-lifecycle-ledger/v1', changes: [{ status: 'active' }] },
    { ...structuredClone(ledger), changes: [...ledger.changes, structuredClone(ledger.changes[0])] },
  ]) {
    const report = buildAiCodingMetricsReport({ policy, generatedAt: '2026-07-30T12:00:00.000Z', lifecycleLedger: invalidLedger });
    assert.equal(metric(report, 'active-change-wip').status, 'not_configured');
    assert.equal(report.source_summary.lifecycle_snapshot, 'not_available');
  }
});

test('first attempt and one diagnostic retry aggregate by package without changing merge truth', () => {
  const failed = observation({ result: 'failed' });
  const failedArtifact = artifact(failed);
  const retry = observation({
    attempt: 2, result: 'passed', observedAt: '2026-07-29T12:01:00.000Z', retryOfSha256: failedArtifact.artifact_sha256,
  });
  const viewer = observation({
    packageId: 'viewer', gateId: 'viewer-verify', testId: 'full-verify', subject: 'e'.repeat(40), result: 'passed',
  });
  validateTelemetryRetryPair(failed, retry, policy, failedArtifact.artifact_sha256);
  const report = buildAiCodingMetricsReport({
    policy, generatedAt: '2026-08-10T12:00:00.000Z', observations: [failedArtifact, artifact(retry), artifact(viewer)],
  });
  assert.equal(metric(report, 'first-pass-gate-yield').value, 0.5);
  assert.equal(metric(report, 'flake-rate').value, 0.5);
  assert.equal(metric(report, 'first-pass-gate-yield').sample_size, 2);
  assert.deepEqual(report.packages.map(({ package_id }) => package_id), ['root-governance', 'viewer']);
  assert.equal(report.source_summary.telemetry.accepted, 3);
  assert.equal(report.decision.reason, 'baseline-provenance-unverified');
});

test('collector rejects no-backfill, future, duplicate, orphan retry, and retry mismatch', () => {
  const valid = artifact(observation());
  const duplicate = structuredClone(valid);
  const old = artifact(observation({ observedAt: '2026-07-27T23:59:59.000Z', subject: '1'.repeat(40) }));
  const future = artifact(observation({ observedAt: '2026-08-20T12:06:00.000Z', subject: '2'.repeat(40) }));
  const orphan = artifact(observation({ attempt: 2, observedAt: '2026-08-20T11:00:00.000Z', subject: '3'.repeat(40) }));
  const firstPassed = artifact(observation({ observedAt: '2026-08-20T10:00:00.000Z', subject: '4'.repeat(40) }));
  const invalidRetry = artifact(observation({
    attempt: 2, observedAt: '2026-08-20T11:00:00.000Z', subject: '4'.repeat(40), retryOfSha256: firstPassed.artifact_sha256,
  }));
  const report = buildAiCodingMetricsReport({
    policy, generatedAt: '2026-08-20T12:00:00.000Z',
    observations: [valid, duplicate, old, future, orphan, firstPassed, invalidRetry],
  });
  const reasons = Object.fromEntries(report.source_summary.telemetry.rejections.map((item) => [item.reason, item.count]));
  assert.equal(reasons.duplicate_observation, 1);
  assert.equal(reasons.historical_backfill_forbidden, 1);
  assert.equal(reasons.future_timestamp, 1);
  assert.equal(reasons.missing_attempt_one, 1);
  assert.equal(reasons.retry_mismatch, 1);
  assert.equal(report.source_summary.telemetry.accepted, 2);
  assert.equal(report.source_summary.telemetry.rejected, 5);
});

test('observation validator rejects open metadata, raw command fields, unknown registry identity, and mixed attempts', () => {
  for (const mutate of [
    (value) => { value.prompt = 'do something'; },
    (value) => { value.command = { args: ['secret'] }; },
    (value) => { value.records[0].path = 'C:/private/file'; },
    (value) => { value.records[0].test_id = 'untrusted-test'; },
    (value) => { value.records[0].trace_sha256 = 'f'.repeat(64); },
    (value) => { value.records[0].timeout_ms = 100; },
    (value) => { value.records.push({ ...value.records[0], test_id: 'full-verify', attempt: 2, retry_of: 1 }); },
  ]) {
    const invalid = observation();
    mutate(invalid);
    assert.throws(() => validateTelemetryObservation(invalid, policy));
  }
});

test('retry requires the same closed envelope and only a failed first attempt', () => {
  const passed = observation();
  const passedArtifact = artifact(passed);
  assert.throws(() => validateTelemetryRetryPair(passed, observation({
    attempt: 2, observedAt: '2026-07-29T12:01:00.000Z', retryOfSha256: passedArtifact.artifact_sha256,
  }), policy, passedArtifact.artifact_sha256));
  const failed = observation({ result: 'failed' });
  const failedArtifact = artifact(failed);
  const otherEnvironment = observation({
    attempt: 2, observedAt: '2026-07-29T12:01:00.000Z', environmentClass: 'local-windows', retryOfSha256: failedArtifact.artifact_sha256,
  });
  assert.throws(() => validateTelemetryRetryPair(failed, otherEnvironment, policy, failedArtifact.artifact_sha256));
  const reverseTimestamp = observation({
    attempt: 2, observedAt: '2026-07-29T11:59:00.000Z', retryOfSha256: failedArtifact.artifact_sha256,
  });
  assert.throws(() => validateTelemetryRetryPair(failed, reverseTimestamp, policy, failedArtifact.artifact_sha256));
  const tampered = structuredClone(failed);
  tampered.records[0].duration_ms += 1;
  const retry = observation({
    attempt: 2, observedAt: '2026-07-29T12:01:00.000Z', retryOfSha256: failedArtifact.artifact_sha256,
  });
  assert.throws(() => validateTelemetryRetryPair(tampered, retry, policy, failedArtifact.artifact_sha256));
});

test('artifact writers enforce fixed namespaces, immutable attempts, and new files', () => {
  const base = path.join(root, 'artifacts');
  mkdirSync(base, { recursive: true });
  const sandbox = mkdtempSync(path.join(base, 'metrics-contract-'));
  try {
    const failed = observation({ result: 'failed' });
    const firstPath = `artifacts/telemetry/ai-coding/${failed.subject_sha}/${failed.package_id}/attempt-1.json`;
    assert.equal(writeTelemetryObservation(sandbox, firstPath, failed, policy), firstPath);
    assert.throws(() => writeTelemetryObservation(sandbox, firstPath, failed, policy));
    const firstFile = path.join(sandbox, ...firstPath.split('/'));
    const firstBytes = readFileSync(firstFile);
    const firstSha256 = createHash('sha256').update(firstBytes).digest('hex');
    const retry = observation({
      attempt: 2, result: 'passed', observedAt: '2026-07-29T12:01:00.000Z', retryOfSha256: firstSha256,
    });
    const retryPath = `artifacts/telemetry/ai-coding/${retry.subject_sha}/${retry.package_id}/attempt-2.json`;
    const tampered = JSON.parse(firstBytes.toString('utf8'));
    tampered.records[0].duration_ms += 1;
    writeFileSync(firstFile, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    assert.throws(() => writeTelemetryObservation(sandbox, retryPath, retry, policy));
    writeFileSync(firstFile, firstBytes);
    assert.equal(writeTelemetryObservation(sandbox, retryPath, retry, policy), retryPath);
    const trustedFirst = readTelemetryArtifact(sandbox, firstPath, policy);
    const trustedRetry = readTelemetryArtifact(sandbox, retryPath, policy);
    validateTelemetryArtifact(trustedFirst, policy);
    const arbitraryDirectory = path.join(sandbox, 'artifacts', 'input');
    mkdirSync(arbitraryDirectory, { recursive: true });
    writeFileSync(path.join(arbitraryDirectory, 'copied.json'), firstBytes);
    assert.throws(() => readTelemetryArtifact(sandbox, 'artifacts/input/copied.json', policy));
    assert.throws(() => writeTelemetryObservation(sandbox, '../escape.json', observation({ subject: '9'.repeat(40) }), policy));

    const sourceReport = buildAiCodingMetricsReport({
      policy, generatedAt: '2026-07-31T12:00:00.000Z', observations: [trustedFirst, trustedRetry],
    });
    const sourceReportPath = 'artifacts/metrics/ai-coding/2026-07-31.json';
    assert.throws(() => writeAiCodingMetricsReport(sandbox, sourceReportPath, structuredClone(sourceReport)));
    const mutatedSourceReport = buildAiCodingMetricsReport({
      policy, generatedAt: '2026-07-31T12:00:00.000Z', observations: [trustedFirst, trustedRetry],
    });
    metric(mutatedSourceReport, 'first-pass-gate-yield').value = 1;
    mutatedSourceReport.packages[0].first_pass_gate_yield = 1;
    validateAiCodingMetricsReport(mutatedSourceReport);
    assert.throws(
      () => writeAiCodingMetricsReport(sandbox, sourceReportPath, mutatedSourceReport),
      (error) => error?.code === 'report_untrusted',
    );
    assert.equal(writeAiCodingMetricsReport(sandbox, sourceReportPath, sourceReport), sourceReportPath);

    const unboundPolicyReport = buildAiCodingMetricsReport({
      policy: structuredClone(policy), generatedAt: '2026-08-01T12:00:00.000Z',
    });
    assert.throws(
      () => writeAiCodingMetricsReport(sandbox, 'artifacts/metrics/ai-coding/2026-08-01.json', unboundPolicyReport),
      (error) => error?.code === 'report_untrusted',
    );

    const report = buildAiCodingMetricsReport({ policy, generatedAt: '2026-07-30T12:00:00.000Z' });
    const reportPath = 'artifacts/metrics/ai-coding/2026-07-30.json';
    assert.equal(writeAiCodingMetricsReport(sandbox, reportPath, report), reportPath);
    assert(existsSync(path.join(sandbox, ...reportPath.split('/'))));
    assert.throws(() => writeAiCodingMetricsReport(sandbox, reportPath, report));
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test('report validator rejects fabricated zero-sample values and premature targets', () => {
  const report = buildAiCodingMetricsReport({ policy, generatedAt: '2026-07-30T12:00:00.000Z' });
  const fabricated = structuredClone(report);
  metric(fabricated, 'first-pass-gate-yield').value = 0;
  assert.throws(() => validateAiCodingMetricsReport(fabricated));
  const targeted = structuredClone(report);
  targeted.decision.improvement_targets = { yield: 0.9 };
  assert.throws(() => validateAiCodingMetricsReport(targeted));
  const forgedPackage = structuredClone(report);
  metric(forgedPackage, 'first-pass-gate-yield').status = 'collecting_baseline';
  metric(forgedPackage, 'first-pass-gate-yield').value = 0;
  metric(forgedPackage, 'first-pass-gate-yield').sample_size = 1;
  metric(forgedPackage, 'flake-rate').status = 'collecting_baseline';
  metric(forgedPackage, 'flake-rate').value = 0;
  metric(forgedPackage, 'flake-rate').sample_size = 1;
  forgedPackage.packages.push({
    package_id: 'viewer', sample_size: 1, first_pass_gate_yield: 0, flake_rate: 0, attempt_one_duration_median_ms: 1,
  });
  assert.throws(() => validateAiCodingMetricsReport(forgedPackage));
});

test('elapsed time alone never upgrades caller-timestamp observations to an attested baseline', () => {
  const report = buildAiCodingMetricsReport({
    policy,
    generatedAt: '2026-09-30T12:00:00.000Z',
    observations: [artifact(observation({ observedAt: '2026-09-30T11:00:00.000Z' }))],
  });
  assert.equal(report.window.elapsed_days > 28, true);
  assert.equal(report.window.phase, 'baseline_provenance_unverified');
  assert.equal(report.decision.reason, 'baseline-provenance-unverified');
  assert.equal(report.decision.improvement_targets, null);
});

test('metrics report rejects more than 16 MiB of declared telemetry inputs before aggregation', () => {
  const item = artifact(observation());
  const oversized = Array.from({ length: 17 }, () => ({ ...structuredClone(item), size_bytes: 1024 * 1024 }));
  assert.throws(() => buildAiCodingMetricsReport({
    policy, generatedAt: '2026-07-30T12:00:00.000Z', observations: oversized,
  }));
});

test('CLI input examples remain bounded JSON without raw trace payloads', () => {
  const item = observation();
  const json = JSON.stringify(item);
  assert(json.length < 1024 * 1024);
  for (const forbidden of ['stdout', 'stderr', 'prompt', 'source', 'raw_trace', 'repository', 'user']) {
    assert.equal(Object.hasOwn(item, forbidden), false);
    assert.equal(Object.hasOwn(item.records[0], forbidden), false);
  }
});
