#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const CONCLUSIONS = new Set([
  'success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure',
]);
const DESIGN_STATUSES = new Set([
  'passed', 'mixed', 'partial_reference_missing', 'gate_infrastructure_only', 'not_applicable',
  'unknown_fail_closed', 'reference_authority_mixed_fail_closed',
]);
const PLAN_REASONS = new Set([
  'affected_path', 'docs_only', 'full_dispatch_requested', 'full_dispatch_self_change', 'path_not_affected',
  'profile_default', 'profile_not_selected', 'unknown_path_fail_closed',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameKeys(value, keys) {
  return isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isWithin(root, candidate, allowEqual = false) {
  const rootValue = pathKey(path.resolve(root));
  const candidateValue = pathKey(path.resolve(candidate));
  return (allowEqual && rootValue === candidateValue) || candidateValue.startsWith(`${rootValue}${path.sep}`);
}

function assertNoLinks(root, candidate) {
  let cursor = path.resolve(root);
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('artifact path contains a symbolic link');
  }
}

function readBoundedFile(filePath, maxBytes, label) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > maxBytes) {
    throw new Error(`${label} must be a bounded regular file`);
  }
  return readFileSync(filePath);
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON`);
  }
}

function resolveArtifactFile(root, relativePath, maxBytes = 128 * 1024 * 1024) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('artifacts/e2e/') ||
      relativePath.includes('\\') || relativePath.includes('\0') ||
      relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('artifact path is not a canonical repository-relative evidence path');
  }
  const resolvedRoot = realpathSync(root);
  const candidate = path.resolve(resolvedRoot, ...relativePath.split('/'));
  if (!isWithin(resolvedRoot, candidate)) throw new Error('artifact path escaped the artifact root');
  assertNoLinks(resolvedRoot, candidate);
  const item = lstatSync(candidate);
  if (!item.isFile() || item.isSymbolicLink() || item.size > maxBytes) throw new Error('artifact file is not bounded and regular');
  return { candidate, size: item.size };
}

function hashFile(candidate) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = openSync(candidate, 'r');
  try {
    for (;;) {
      const count = readSync(handle, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(handle);
  }
  return hash.digest('hex');
}

function safeArtifactJson(root, relativePath, maxBytes = 2 * 1024 * 1024) {
  const { candidate } = resolveArtifactFile(root, relativePath, maxBytes);
  return readBoundedFile(candidate, maxBytes, 'artifact JSON');
}

function errorReport(message = 'Merge evidence input could not be processed safely.') {
  return {
    schema_version: 'merge-evidence-report/v1',
    result: 'input_error',
    authority: 'unavailable',
    base_sha: null,
    subject_sha: null,
    source_run_id: null,
    plan_sha256: null,
    semantic_validation: 'failed',
    completion_eligible: false,
    full_completion: false,
    summary: { target_count: 0, required_count: 0, typed_skip_count: 0, error_count: 1 },
    outcomes: [],
    errors: [{ code: 'input_invalid', target_id: null, message }],
  };
}

function validateResultArtifact(value) {
  if (!sameKeys(value, ['artifact_name_prefix', 'result_path', 'kind', 'schema_version', 'subject_field']) ||
      typeof value.artifact_name_prefix !== 'string' || !/^[a-z0-9][a-z0-9-]*-$/u.test(value.artifact_name_prefix) ||
      typeof value.result_path !== 'string' || !value.result_path.startsWith('artifacts/e2e/') ||
      value.result_path.includes('\\') || value.result_path.includes('\0') ||
      value.result_path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !['ai-bim-design-system-visual-result', 'ai-bim-functional-runtime-result'].includes(value.kind) ||
      ![1, 2].includes(value.schema_version) || value.subject_field !== 'subject_commit') {
    throw new Error('plan result_artifact is invalid');
  }
}

function validatePlan(plan) {
  if (!sameKeys(plan, ['schema_version', 'manifest_version', 'base_sha', 'subject_sha', 'result', 'dispatch',
    'changed_paths', 'unknown_paths', 'targets', 'errors']) ||
      plan.schema_version !== 'verification-plan/v2' || typeof plan.manifest_version !== 'string' ||
      (plan.base_sha !== null && !COMMIT.test(plan.base_sha)) || (plan.subject_sha !== null && !COMMIT.test(plan.subject_sha)) ||
      !['planned', 'fail_closed', 'input_error'].includes(plan.result) ||
      !['affected', 'full', 'profile', 'none'].includes(plan.dispatch) || !Array.isArray(plan.changed_paths) ||
      !Array.isArray(plan.unknown_paths) || !Array.isArray(plan.targets) || plan.targets.length > 100 ||
      !Array.isArray(plan.errors)) {
    throw new Error('verification plan envelope is invalid');
  }
  const targetIds = new Set();
  for (const target of plan.targets) {
    if (!sameKeys(target, ['id', 'display_name', 'owner', 'required', 'reason', 'ci_output', 'ci_job', 'result_artifact', 'gates']) ||
        typeof target.id !== 'string' || !ID.test(target.id) || targetIds.has(target.id) ||
        typeof target.display_name !== 'string' || typeof target.owner !== 'string' || typeof target.required !== 'boolean' ||
        !PLAN_REASONS.has(target.reason) || typeof target.ci_job !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9 ._:/()-]{0,199}$/u.test(target.ci_job) ||
        (target.ci_output !== null && (typeof target.ci_output !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(target.ci_output))) ||
        !Array.isArray(target.gates) || target.gates.length === 0) {
      throw new Error('verification plan target is invalid');
    }
    targetIds.add(target.id);
    if (target.result_artifact !== null) validateResultArtifact(target.result_artifact);
  }
}

function validateJobResults(value) {
  const keys = [
    'schema_version', 'authority', 'repository', 'repository_id', 'source_workflow', 'source_workflow_id', 'source_workflow_path', 'source_run_id',
    'source_run_attempt', 'event_name', 'pull_request_number', 'body_sha256', 'base_ref', 'base_sha', 'subject_sha', 'live_head_sha',
    'source_conclusion', 'jobs', 'artifacts',
  ];
  if (!sameKeys(value, keys) || value.schema_version !== 'verification-job-results/v1' ||
      !['trusted_base', 'trusted_main', 'bootstrap_untrusted'].includes(value.authority) ||
      typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository) ||
      !Number.isSafeInteger(value.repository_id) || value.repository_id < 1 || value.source_workflow !== 'CI' ||
      !Number.isSafeInteger(value.source_workflow_id) || value.source_workflow_id < 1 ||
      value.source_workflow_path !== '.github/workflows/ci.yml' ||
      !Number.isSafeInteger(value.source_run_id) || value.source_run_id < 1 ||
      !Number.isSafeInteger(value.source_run_attempt) || value.source_run_attempt < 1 ||
      !['pull_request', 'push'].includes(value.event_name) ||
      (value.pull_request_number !== null && (!Number.isSafeInteger(value.pull_request_number) || value.pull_request_number < 1)) ||
      typeof value.body_sha256 !== 'string' || !DIGEST.test(value.body_sha256) ||
      typeof value.base_ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(value.base_ref) ||
      (value.base_sha !== null && !COMMIT.test(value.base_sha)) || !COMMIT.test(value.subject_sha) ||
      !COMMIT.test(value.live_head_sha) || !CONCLUSIONS.has(value.source_conclusion) ||
      !Array.isArray(value.jobs) || value.jobs.length > 200 || !Array.isArray(value.artifacts) || value.artifacts.length > 3) {
    throw new Error('workflow-run observation is invalid');
  }
  for (const job of value.jobs) {
    if (!sameKeys(job, ['name', 'conclusion']) || typeof job.name !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9 ._:/()\[\]-]{0,199}$/u.test(job.name) ||
        !CONCLUSIONS.has(job.conclusion)) throw new Error('workflow job result is invalid');
  }
  for (const artifact of value.artifacts) {
    if (!sameKeys(artifact, ['id', 'name', 'size_in_bytes', 'expired', 'source_run_id', 'source_run_attempt', 'subject_sha']) ||
        !Number.isSafeInteger(artifact.id) || artifact.id < 1 ||
        typeof artifact.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(artifact.name) ||
        !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1 || artifact.size_in_bytes > 128 * 1024 * 1024 ||
        typeof artifact.expired !== 'boolean' || !Number.isSafeInteger(artifact.source_run_id) ||
        !Number.isSafeInteger(artifact.source_run_attempt) || artifact.source_run_attempt < 1 ||
        !COMMIT.test(artifact.subject_sha)) throw new Error('workflow artifact metadata is invalid');
  }
}

function validateDesignScope(value) {
  if (!sameKeys(value, ['schema_version', 'base_sha', 'subject_sha', 'status', 'frontend_product', 'visual_required',
    'full_completion_allowed', 'required_screen_ids', 'reference_missing_items']) ||
      value.schema_version !== 'design-scope/v1' || !COMMIT.test(value.base_sha) || !COMMIT.test(value.subject_sha) ||
      !DESIGN_STATUSES.has(value.status) || typeof value.frontend_product !== 'boolean' ||
      typeof value.visual_required !== 'boolean' || typeof value.full_completion_allowed !== 'boolean' ||
      !Array.isArray(value.required_screen_ids) || value.required_screen_ids.length > 100 ||
      value.required_screen_ids.some((item) => typeof item !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/u.test(item)) ||
      new Set(value.required_screen_ids).size !== value.required_screen_ids.length ||
      !Array.isArray(value.reference_missing_items) || value.reference_missing_items.length > 100 ||
      value.reference_missing_items.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 200 || /[\0\r\n]/u.test(item))) {
    throw new Error('design scope observation is invalid');
  }
}

function verifyHashedFile(artifactRoot, item, errors, targetId, budget) {
  if (!isObject(item) || typeof item.path !== 'string' || typeof item.sha256 !== 'string' || !DIGEST.test(item.sha256)) {
    errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Evidence contains an invalid path or SHA-256 field.' });
    return;
  }
  try {
    const { candidate, size } = resolveArtifactFile(artifactRoot, item.path);
    budget.files += 1;
    budget.bytes += size;
    if (budget.files > 128 || budget.bytes > 512 * 1024 * 1024) throw new Error('artifact evidence exceeds aggregate budget');
    if (hashFile(candidate) !== item.sha256) {
      errors.push({ code: 'artifact_hash_mismatch', target_id: targetId, message: 'Evidence artifact SHA-256 does not match its result.' });
    }
  } catch {
    errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Evidence artifact path is missing, linked, oversized, or outside its root.' });
  }
}

function validateEvidenceResult(artifactRoot, contract, subjectSha, errors, targetId, requiredScreenIds = []) {
  let result;
  try {
    const bytes = safeArtifactJson(artifactRoot, contract.result_path);
    result = parseJsonBytes(bytes, 'evidence result');
  } catch {
    errors.push({ code: 'artifact_missing', target_id: targetId, message: 'Required evidence result is missing or untrusted.' });
    return false;
  }
  if (!isObject(result) || result.kind !== contract.kind || result.schema_version !== contract.schema_version ||
      result.status !== 'passed' || result[contract.subject_field] !== subjectSha || result.workspace_clean !== true) {
    errors.push({ code: result?.[contract.subject_field] === subjectSha ? 'artifact_invalid' : 'artifact_stale',
      target_id: targetId, message: 'Evidence result kind, schema, status, clean flag, or subject is invalid.' });
    return false;
  }
  const before = errors.length;
  const budget = { files: 0, bytes: 0 };
  if (contract.kind === 'ai-bim-functional-runtime-result') {
    if (result.skipped !== false || result.blocked !== false || !Array.isArray(result.artifacts) ||
        result.artifacts.length === 0 || result.artifacts.length > 100) {
      errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Functional/runtime result is skipped, blocked, or lacks bounded artifacts.' });
    } else {
      for (const item of result.artifacts) verifyHashedFile(artifactRoot, item, errors, targetId, budget);
    }
  } else {
    if (!Array.isArray(result.screens) || result.screens.length === 0 || result.screens.length > 100) {
      errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Visual result lacks bounded screen evidence.' });
    } else {
      const observedIds = result.screens.map((screen) => screen?.id);
      if (observedIds.some((id) => typeof id !== 'string') || new Set(observedIds).size !== observedIds.length ||
          requiredScreenIds.some((id) => !observedIds.includes(id))) {
        errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Visual result is missing a trusted required screen id.' });
      }
      for (const screen of result.screens) {
        if (!isObject(screen) || screen.semantic_parity !== 1 || !Array.isArray(screen.viewports) ||
            screen.viewports.length === 0 || screen.viewports.length > 20) {
          errors.push({ code: 'artifact_invalid', target_id: targetId, message: 'Visual result contains an invalid semantic screen or viewport set.' });
          continue;
        }
        for (const viewport of screen.viewports) {
          verifyHashedFile(artifactRoot, { path: viewport?.actual_path, sha256: viewport?.actual_sha256 }, errors, targetId, budget);
          verifyHashedFile(artifactRoot, { path: viewport?.diff_path, sha256: viewport?.diff_sha256 }, errors, targetId, budget);
        }
      }
    }
  }
  return errors.length === before;
}

export function evaluateMergeEvidence({ trustedPlanBytes, candidatePlanBytes, jobResults, designScope, artifactsRoot, expected = null }) {
  const trustedPlan = parseJsonBytes(trustedPlanBytes, 'trusted plan');
  const candidatePlan = parseJsonBytes(candidatePlanBytes, 'candidate plan');
  validatePlan(trustedPlan);
  validatePlan(candidatePlan);
  validateJobResults(jobResults);
  validateDesignScope(designScope);
  const errors = [];
  const outcomes = [];
  const planDigest = sha256(candidatePlanBytes);
  if (expected === null) {
    errors.push({ code: 'source_run_invalid', target_id: null, message: 'Trusted event envelope is required.' });
  } else if (!isObject(expected) || expected.repository !== jobResults.repository ||
      expected.repository_id !== jobResults.repository_id || expected.source_workflow_id !== jobResults.source_workflow_id ||
      expected.base_ref !== jobResults.base_ref ||
      expected.source_run_id !== jobResults.source_run_id || expected.source_run_attempt !== jobResults.source_run_attempt ||
      expected.pull_request_number !== jobResults.pull_request_number) {
    errors.push({ code: 'source_run_invalid', target_id: null, message: 'Workflow observation does not match the trusted event envelope.' });
  }
  if (jobResults.event_name !== 'pull_request' || jobResults.pull_request_number === null) {
    errors.push({ code: 'source_run_invalid', target_id: null, message: 'Merge authority is only available for a pull_request workflow run.' });
  }
  if (!Buffer.from(trustedPlanBytes).equals(Buffer.from(candidatePlanBytes))) {
    errors.push({ code: 'plan_mismatch', target_id: null, message: 'Candidate plan differs from the exact base-pinned plan.' });
  }
  if (candidatePlan.result !== 'planned') {
    errors.push({ code: 'plan_not_planned', target_id: null, message: 'Verification plan did not produce a planned result.' });
  }
  if (jobResults.authority === 'bootstrap_untrusted') {
    errors.push({ code: 'bootstrap_not_authoritative', target_id: null, message: 'Bootstrap diagnostics cannot grant merge authority.' });
  }
  if (candidatePlan.targets.some(({ reason }) => reason === 'full_dispatch_self_change')) {
    errors.push({ code: 'self_change_requires_two_phase', target_id: null, message: 'Gate self-changes require a separately administered two-phase activation.' });
  }
  if (jobResults.source_conclusion !== 'success') {
    errors.push({ code: 'source_run_invalid', target_id: null, message: 'Source CI workflow did not conclude successfully.' });
  }
  if (candidatePlan.base_sha !== jobResults.base_sha || candidatePlan.base_sha !== designScope.base_sha ||
      candidatePlan.subject_sha !== jobResults.subject_sha || candidatePlan.subject_sha !== jobResults.live_head_sha ||
      candidatePlan.subject_sha !== designScope.subject_sha || candidatePlan.base_sha === null || candidatePlan.subject_sha === null) {
    errors.push({ code: 'subject_mismatch', target_id: null, message: 'Plan, workflow run, live PR head, and design scope are not bound to one base/head pair.' });
  }
  const jobMap = new Map();
  for (const job of jobResults.jobs) {
    if (jobMap.has(job.name)) errors.push({ code: 'job_duplicate', target_id: null, message: 'Workflow run contains a duplicate job name.' });
    else jobMap.set(job.name, job.conclusion);
  }
  if (jobMap.get('changed path classifier') !== 'success') {
    errors.push({ code: jobMap.has('changed path classifier') ? 'job_conclusion_invalid' : 'job_missing', target_id: null,
      message: 'Changed-path classifier job is missing or did not succeed.' });
  }
  const targetsByJob = new Map();
  for (const target of candidatePlan.targets) {
    if (!targetsByJob.has(target.ci_job)) targetsByJob.set(target.ci_job, []);
    targetsByJob.get(target.ci_job).push(target);
  }
  for (const [jobName, targets] of targetsByJob) {
    const conclusion = jobMap.get(jobName) ?? null;
    const required = targets.some((target) => target.required);
    let acceptable = false;
    if (required) acceptable = conclusion === 'success';
    else acceptable = conclusion === 'success' || conclusion === 'skipped';
    if (!acceptable) {
      errors.push({ code: conclusion === null ? 'job_missing' : 'job_conclusion_invalid', target_id: targets[0].id,
        message: required ? 'A required CI job did not conclude success.' : 'A non-required CI job had an invalid terminal conclusion.' });
    }
    for (const target of targets) {
      const policyIncomplete = target.required && target.gates.some(({ configured }) => configured === false);
      outcomes.push({
        target_id: target.id,
        ci_job: target.ci_job,
        required: target.required,
        plan_reason: target.reason,
        job_conclusion: conclusion,
        evidence_result: acceptable ? (policyIncomplete ? 'incomplete' : (target.required ? 'passed' : (conclusion === 'success' ? 'overrun' : 'not_required'))) : 'failed',
        semantic_validation_required: target.required && target.result_artifact !== null,
      });
    }
  }
  const artifactMap = new Map();
  for (const artifact of jobResults.artifacts) {
    if (artifactMap.has(artifact.name)) errors.push({ code: 'artifact_duplicate', target_id: null, message: 'Workflow run contains a duplicate artifact name.' });
    else artifactMap.set(artifact.name, artifact);
  }
  const attemptSuffix = `${jobResults.subject_sha}-attempt-${jobResults.source_run_attempt}`;
  const planArtifactName = `verification-plan-${attemptSuffix}`;
  const planArtifact = artifactMap.get(planArtifactName);
  if (!planArtifact || planArtifact.expired || planArtifact.source_run_id !== jobResults.source_run_id ||
      planArtifact.source_run_attempt !== jobResults.source_run_attempt ||
      planArtifact.subject_sha !== jobResults.subject_sha) {
    errors.push({ code: 'artifact_missing', target_id: null, message: 'Commit-bound verification plan artifact is missing, expired, or cross-run.' });
  }
  let typedSkipCount = 0;
  let fullCompletion = !outcomes.some(({ required, evidence_result: evidenceResult }) => required && evidenceResult === 'incomplete');
  for (const target of candidatePlan.targets.filter(({ required, result_artifact: artifact }) => required && artifact !== null)) {
    if (target.id === 'design-semantic-visual' && designScope.visual_required === false) {
      if (designScope.status === 'partial_reference_missing' && designScope.frontend_product === true &&
          designScope.reference_missing_items.length > 0) {
        const outcome = outcomes.find(({ target_id: id }) => id === target.id);
        if (outcome) outcome.evidence_result = 'typed_skip';
        if (outcome) outcome.semantic_validation_required = false;
        typedSkipCount += 1;
        fullCompletion = false;
        continue;
      }
      errors.push({ code: 'design_scope_invalid', target_id: target.id, message: 'Visual evidence was skipped without a typed reference-missing scope.' });
      continue;
    }
    const artifactName = `${target.result_artifact.artifact_name_prefix}${attemptSuffix}`;
    const metadata = artifactMap.get(artifactName);
    if (!metadata || metadata.expired || metadata.source_run_id !== jobResults.source_run_id ||
        metadata.source_run_attempt !== jobResults.source_run_attempt || metadata.subject_sha !== jobResults.subject_sha) {
      errors.push({ code: 'artifact_missing', target_id: target.id, message: 'Required commit-bound result artifact is missing, expired, or cross-run.' });
      continue;
    }
    const root = path.resolve(artifactsRoot, artifactName);
    try {
      if (!isWithin(path.resolve(artifactsRoot), root)) throw new Error('artifact directory escaped root');
      assertNoLinks(path.resolve(artifactsRoot), root);
      validateEvidenceResult(root, target.result_artifact, jobResults.subject_sha, errors, target.id,
        target.id === 'design-semantic-visual' ? designScope.required_screen_ids : []);
    } catch {
      errors.push({ code: 'artifact_invalid', target_id: target.id, message: 'Required artifact directory is missing, linked, or outside the evidence root.' });
    }
  }
  if (candidatePlan.targets.some(({ id, required }) => id === 'design-semantic-visual' && required) &&
      designScope.visual_required && !designScope.full_completion_allowed) fullCompletion = false;
  const authority = jobResults.authority;
  const result = authority === 'bootstrap_untrusted' ? 'bootstrap_only' : (errors.length === 0 ? 'prevalidated' : 'failed');
  return {
    schema_version: 'merge-evidence-report/v1',
    result,
    authority,
    base_sha: candidatePlan.base_sha,
    subject_sha: candidatePlan.subject_sha,
    source_run_id: jobResults.source_run_id,
    plan_sha256: planDigest,
    semantic_validation: result === 'prevalidated' ? 'pending' : 'failed',
    completion_eligible: errors.length === 0 && fullCompletion,
    full_completion: false,
    summary: {
      target_count: candidatePlan.targets.length,
      required_count: candidatePlan.targets.filter(({ required }) => required).length,
      typed_skip_count: typedSkipCount,
      error_count: errors.length,
    },
    outcomes,
    errors,
  };
}

const SEMANTIC_VALIDATORS = new Map([
  ['functional-runtime-conv', 'functional-runtime-result/v1'],
  ['design-semantic-visual', 'design-system-visual-result/v2'],
]);

export function finalizeMergeEvidence(preliminary, semanticResults) {
  if (!isObject(preliminary) || !isObject(preliminary.summary) || !Number.isSafeInteger(preliminary.summary.error_count) ||
      !Array.isArray(preliminary.errors)) return errorReport('Prevalidated report is invalid.');
  const invalid = (message) => ({
    ...preliminary,
    result: 'failed',
    semantic_validation: 'failed',
    full_completion: false,
    summary: { ...preliminary.summary, error_count: preliminary.summary.error_count + 1 },
    errors: [...preliminary.errors, { code: 'semantic_validation_invalid', target_id: null, message }],
  });
  try {
    const reportKeys = ['schema_version', 'result', 'authority', 'base_sha', 'subject_sha', 'source_run_id', 'plan_sha256',
      'semantic_validation', 'completion_eligible', 'full_completion', 'summary', 'outcomes', 'errors'];
    if (!sameKeys(preliminary, reportKeys) || preliminary.schema_version !== 'merge-evidence-report/v1' ||
        preliminary.result !== 'prevalidated' || preliminary.semantic_validation !== 'pending' ||
        !COMMIT.test(preliminary.subject_sha) || preliminary.errors.length !== 0 || !Array.isArray(preliminary.outcomes) ||
        !sameKeys(semanticResults, ['schema_version', 'subject_sha', 'validators']) ||
        semanticResults.schema_version !== 'semantic-validation-results/v1' ||
        semanticResults.subject_sha !== preliminary.subject_sha || !Array.isArray(semanticResults.validators) ||
        semanticResults.validators.length > 10) return invalid('Semantic validation envelope is invalid.');
    const expected = new Map(preliminary.outcomes
      .filter(({ semantic_validation_required: required }) => required)
      .map(({ target_id: id }) => [id, SEMANTIC_VALIDATORS.get(id)]));
    if ([...expected.values()].some((value) => value === undefined)) return invalid('A required result has no base-controlled semantic validator.');
    const observed = new Map();
    for (const item of semanticResults.validators) {
      if (!sameKeys(item, ['target_id', 'validator', 'result']) || !SEMANTIC_VALIDATORS.has(item.target_id) ||
          item.validator !== SEMANTIC_VALIDATORS.get(item.target_id) || item.result !== 'passed' || observed.has(item.target_id)) {
        return invalid('Semantic validation result is invalid or duplicated.');
      }
      observed.set(item.target_id, item.validator);
    }
    if (observed.size !== expected.size || [...expected].some(([id, validator]) => observed.get(id) !== validator)) {
      return invalid('Semantic validation results do not cover every required evidence artifact.');
    }
    return { ...preliminary, result: 'passed', semantic_validation: 'complete', full_completion: preliminary.completion_eligible };
  } catch {
    return invalid('Semantic validation could not be finalized safely.');
  }
}

function parseArgs(argv) {
  const allowed = new Map([
    ['--trusted-plan', 'trustedPlan'], ['--job-results', 'jobResults'], ['--design-scope', 'designScope'],
    ['--artifacts-root', 'artifactsRoot'], ['--report', 'report'], ['--expected-repository', 'expectedRepository'],
    ['--expected-repository-id', 'expectedRepositoryId'], ['--expected-workflow-id', 'expectedWorkflowId'],
    ['--expected-base-ref', 'expectedBaseRef'],
    ['--expected-run-id', 'expectedRunId'], ['--expected-run-attempt', 'expectedRunAttempt'], ['--expected-pr', 'expectedPr'],
  ]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || result[key] !== undefined) throw new Error('invalid arguments');
    result[key] = value;
  }
  if ([...allowed.values()].some((key) => !result[key])) throw new Error('missing required argument');
  return result;
}

function parseFinalizeArgs(argv) {
  const allowed = new Map([['--prevalidated-report', 'prevalidatedReport'], ['--semantic-results', 'semanticResults'], ['--report', 'report']]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || result[key] !== undefined) throw new Error('invalid finalize arguments');
    result[key] = value;
  }
  if ([...allowed.values()].some((key) => !result[key])) throw new Error('missing finalize argument');
  return result;
}

function runCli() {
  let report;
  let reportPath = null;
  try {
    const finalize = process.argv[2] === 'finalize';
    const args = finalize ? parseFinalizeArgs(process.argv.slice(3)) : parseArgs(process.argv.slice(2));
    reportPath = path.resolve(args.report);
    if (finalize) {
      report = finalizeMergeEvidence(
        parseJsonBytes(readBoundedFile(path.resolve(args.prevalidatedReport), 2 * 1024 * 1024, 'prevalidated report'), 'prevalidated report'),
        parseJsonBytes(readBoundedFile(path.resolve(args.semanticResults), 1024 * 1024, 'semantic results'), 'semantic results'),
      );
    } else {
      const artifactsRoot = realpathSync(path.resolve(args.artifactsRoot));
      const jobResults = parseJsonBytes(readBoundedFile(path.resolve(args.jobResults), 2 * 1024 * 1024, 'job results'), 'job results');
      validateJobResults(jobResults);
      const attemptSuffix = `${jobResults.subject_sha}-attempt-${jobResults.source_run_attempt}`;
      const candidatePlanPath = path.resolve(artifactsRoot, `verification-plan-${attemptSuffix}`, 'verification-plan.json');
      if (!isWithin(artifactsRoot, candidatePlanPath)) throw new Error('candidate plan escaped artifact root');
      assertNoLinks(artifactsRoot, candidatePlanPath);
      report = evaluateMergeEvidence({
        trustedPlanBytes: readBoundedFile(path.resolve(args.trustedPlan), 2 * 1024 * 1024, 'trusted plan'),
        candidatePlanBytes: readBoundedFile(candidatePlanPath, 2 * 1024 * 1024, 'candidate plan'),
        jobResults,
        designScope: parseJsonBytes(readBoundedFile(path.resolve(args.designScope), 1024 * 1024, 'design scope'), 'design scope'),
        artifactsRoot,
        expected: {
          repository: args.expectedRepository,
          repository_id: Number(args.expectedRepositoryId),
          source_workflow_id: Number(args.expectedWorkflowId),
          base_ref: args.expectedBaseRef,
          source_run_id: Number(args.expectedRunId),
          source_run_attempt: Number(args.expectedRunAttempt),
          pull_request_number: Number(args.expectedPr),
        },
      });
    }
  } catch {
    report = errorReport();
  }
  const json = `${JSON.stringify(report)}\n`;
  if (reportPath) writeFileSync(reportPath, json, 'utf8');
  process.stdout.write(json);
  process.exitCode = ['passed', 'prevalidated'].includes(report.result) ? 0 : (report.result === 'input_error' ? 3 : 2);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) runCli();
