const OBSERVATION_SCHEMA_VERSION = 'gitnexus-worktree-health-observation/v1';
const REPORT_SCHEMA_VERSION = 'gitnexus-worktree-health-report/v1';
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;
const OWNER_STATUSES = new Set(['active', 'idle', 'ended', 'unclaimed', 'unknown']);
const GITNEXUS_STATUSES = new Set(['healthy', 'stale', 'unavailable', 'unknown']);
const FTS_STATUSES = new Set(['healthy', 'missing', 'degraded', 'unknown']);
const SEVERITY_RANK = { error: 0, unknown: 1, warning: 2 };

function fail(message) {
  throw new Error(`gitnexus-worktree-health: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
}

function assertExactKeys(value, allowed, required, label) {
  assertRecord(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  }
}

function assertString(value, label, { nullable = false, maxLength = 1024 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || /[\0-\x1f]/.test(value)) {
    fail(`${label} must be a bounded non-empty string`);
  }
}

function assertSha(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !SHA_PATTERN.test(value)) fail(`${label} must be a 40- or 64-character Git object id`);
}

function assertNullableTimestamp(value, label) {
  if (value === null) return;
  assertString(value, label, { maxLength: 64 });
  if (!Number.isFinite(Date.parse(value))) fail(`${label} must be an ISO-compatible timestamp or null`);
}

function displayPath(value) {
  assertString(value, 'path');
  const replaced = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\/$/.test(replaced)) return replaced;
  return replaced.replace(/\/+$/, '');
}

export function normalizeRepositoryPath(value) {
  const normalized = displayPath(value);
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) return normalized.toLowerCase();
  return normalized;
}

function normalizeBranch(value, label) {
  if (value === null) return null;
  assertString(value, label, { maxLength: 512 });
  return value.startsWith('refs/heads/') ? value : `refs/heads/${value}`;
}

function validateCurrentCheckout(value) {
  const keys = ['path', 'head_sha', 'origin_main_sha', 'branch', 'dirty'];
  assertExactKeys(value, keys, keys, 'observation.current_checkout');
  assertString(value.path, 'observation.current_checkout.path');
  assertSha(value.head_sha, 'observation.current_checkout.head_sha');
  assertSha(value.origin_main_sha, 'observation.current_checkout.origin_main_sha', { nullable: true });
  normalizeBranch(value.branch, 'observation.current_checkout.branch');
  if (typeof value.dirty !== 'boolean') fail('observation.current_checkout.dirty must be boolean');
}

function validateWorktree(value, index) {
  const label = `observation.worktrees[${index}]`;
  const keys = ['path', 'head_sha', 'branch', 'dirty', 'locked', 'prunable', 'owner', 'owner_status', 'last_activity'];
  assertExactKeys(value, keys, keys, label);
  assertString(value.path, `${label}.path`);
  assertSha(value.head_sha, `${label}.head_sha`);
  normalizeBranch(value.branch, `${label}.branch`);
  if (value.dirty !== null && typeof value.dirty !== 'boolean') fail(`${label}.dirty must be boolean or null`);
  if (typeof value.locked !== 'boolean') fail(`${label}.locked must be boolean`);
  if (typeof value.prunable !== 'boolean') fail(`${label}.prunable must be boolean`);
  if (value.owner !== null) assertString(value.owner, `${label}.owner`, { maxLength: 128 });
  if (!OWNER_STATUSES.has(value.owner_status)) fail(`${label}.owner_status is not recognized`);
  if (value.owner === null && !['unclaimed', 'unknown'].includes(value.owner_status)) {
    fail(`${label}.owner_status cannot imply an owner when owner is null`);
  }
  assertNullableTimestamp(value.last_activity, `${label}.last_activity`);
}

function validateGitNexus(value) {
  if (value === null) return;
  const keys = ['status', 'indexed_path', 'indexed_commit', 'fts_status', 'registrations'];
  assertExactKeys(value, keys, keys, 'observation.gitnexus');
  if (!GITNEXUS_STATUSES.has(value.status)) fail('observation.gitnexus.status is not recognized');
  if (value.indexed_path !== null) assertString(value.indexed_path, 'observation.gitnexus.indexed_path');
  assertSha(value.indexed_commit, 'observation.gitnexus.indexed_commit', { nullable: true });
  if ((value.indexed_path === null) !== (value.indexed_commit === null)) {
    fail('observation.gitnexus.indexed_path and indexed_commit must both be null or both be present');
  }
  if (!FTS_STATUSES.has(value.fts_status)) fail('observation.gitnexus.fts_status is not recognized');
  if (!Array.isArray(value.registrations) || value.registrations.length > 100) {
    fail('observation.gitnexus.registrations must be an array with at most 100 entries');
  }
  value.registrations.forEach((registration, index) => {
    const label = `observation.gitnexus.registrations[${index}]`;
    assertExactKeys(registration, ['name', 'path'], ['name', 'path'], label);
    assertString(registration.name, `${label}.name`, { maxLength: 256 });
    assertString(registration.path, `${label}.path`);
  });
}

export function validateGitNexusWorktreeObservation(observation) {
  const keys = ['schema_version', 'repository_name', 'current_checkout', 'worktrees', 'gitnexus'];
  assertExactKeys(observation, keys, keys, 'observation');
  if (observation.schema_version !== OBSERVATION_SCHEMA_VERSION) fail(`unsupported observation schema_version ${observation.schema_version}`);
  assertString(observation.repository_name, 'observation.repository_name', { maxLength: 256 });
  validateCurrentCheckout(observation.current_checkout);
  if (!Array.isArray(observation.worktrees) || observation.worktrees.length === 0 || observation.worktrees.length > 200) {
    fail('observation.worktrees must contain between 1 and 200 entries');
  }
  observation.worktrees.forEach(validateWorktree);
  validateGitNexus(observation.gitnexus);

  const pathKeys = observation.worktrees.map((worktree) => normalizeRepositoryPath(worktree.path));
  if (new Set(pathKeys).size !== pathKeys.length) fail('observation.worktrees contains duplicate normalized paths');
  const currentKey = normalizeRepositoryPath(observation.current_checkout.path);
  const currentMatches = observation.worktrees.filter((worktree) => normalizeRepositoryPath(worktree.path) === currentKey);
  if (currentMatches.length !== 1) fail('observation.current_checkout.path must identify exactly one registered worktree');
  const currentWorktree = currentMatches[0];
  if (currentWorktree.head_sha.toLowerCase() !== observation.current_checkout.head_sha.toLowerCase()) {
    fail('observation current checkout and worktree HEAD values disagree');
  }
  if (normalizeBranch(currentWorktree.branch, 'current worktree branch') !== normalizeBranch(observation.current_checkout.branch, 'current checkout branch')) {
    fail('observation current checkout and worktree branch values disagree');
  }
  if (currentWorktree.dirty !== observation.current_checkout.dirty) {
    fail('observation current checkout and worktree dirty values disagree');
  }
  return observation;
}

function worktreeKind(path, isCurrent, isCanonical) {
  if (isCurrent) return isCanonical ? 'canonical' : 'current';
  if (isCanonical) return 'canonical';
  const key = normalizeRepositoryPath(path);
  if (/\/(?:users\/deploy|deploy)\//.test(key)) return 'deployment';
  if (key.includes('/.claude/worktrees/') || key.includes('/.codex/worktrees/')) return 'tooling';
  return 'linked';
}

function addFinding(findings, code, severity, message, path = null) {
  findings.push({ code, severity, message, path });
}

function overallStatus(findings) {
  if (findings.some((finding) => finding.severity === 'error')) return 'unhealthy';
  if (findings.some((finding) => finding.severity === 'unknown')) return 'unknown';
  if (findings.some((finding) => finding.severity === 'warning')) return 'warning';
  return 'healthy';
}

function sortFindings(findings) {
  return findings.sort((left, right) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
      || left.code.localeCompare(right.code)
      || (left.path ?? '').localeCompare(right.path ?? '')
      || left.message.localeCompare(right.message));
}

function registrationState(observation, gitnexus) {
  if (gitnexus === null) return { status: 'unknown', count: 0, currentPathRegistered: null, paths: [] };
  const relevant = gitnexus.registrations.filter((registration) =>
    registration.name.localeCompare(observation.repository_name, undefined, { sensitivity: 'accent' }) === 0);
  const uniquePaths = new Set(relevant.map((registration) => normalizeRepositoryPath(registration.path)));
  let status = 'unique';
  if (relevant.length === 0) status = 'missing';
  else if (uniquePaths.size > 1) status = 'ambiguous';
  else if (relevant.length > 1) status = 'duplicate';
  const currentKey = normalizeRepositoryPath(observation.current_checkout.path);
  return {
    status,
    count: relevant.length,
    currentPathRegistered: relevant.some((registration) => normalizeRepositoryPath(registration.path) === currentKey),
    paths: [...uniquePaths],
  };
}

function buildGitNexusReport(observation, canonical, findings) {
  const gitnexus = observation.gitnexus;
  const registrations = registrationState(observation, gitnexus);
  if (gitnexus === null) {
    addFinding(findings, 'gitnexus_observation_missing', 'unknown', 'GitNexus index, FTS, and registry state were not observed; no other checkout was used as a substitute.');
    return {
      status: 'unknown', indexed_path: null, indexed_commit: null, index_freshness: 'unknown', fts_status: 'unknown',
      registration_status: registrations.status, registration_count: registrations.count, current_checkout_trust: 'unknown',
    };
  }

  if (gitnexus.status === 'stale') addFinding(findings, 'gitnexus_index_stale', 'error', 'GitNexus reported a stale index.', gitnexus.indexed_path);
  if (gitnexus.status === 'unavailable') addFinding(findings, 'gitnexus_unavailable', 'unknown', 'GitNexus status was unavailable.', gitnexus.indexed_path);
  if (gitnexus.status === 'unknown') addFinding(findings, 'gitnexus_status_unknown', 'unknown', 'GitNexus status is unknown.', gitnexus.indexed_path);
  if (gitnexus.fts_status === 'missing') addFinding(findings, 'gitnexus_fts_missing', 'error', 'GitNexus FTS indexes are missing.', gitnexus.indexed_path);
  if (gitnexus.fts_status === 'degraded') addFinding(findings, 'gitnexus_fts_degraded', 'error', 'GitNexus FTS indexes are degraded.', gitnexus.indexed_path);
  if (gitnexus.fts_status === 'unknown') addFinding(findings, 'gitnexus_fts_unknown', 'unknown', 'GitNexus FTS state is unknown.', gitnexus.indexed_path);
  if (registrations.status === 'missing') addFinding(findings, 'gitnexus_registration_missing', 'error', 'No matching GitNexus repository registration was observed.');
  if (registrations.status === 'duplicate') addFinding(findings, 'gitnexus_registration_duplicate', 'error', 'The repository has duplicate GitNexus registrations for the same normalized path.');
  if (registrations.status === 'ambiguous') addFinding(findings, 'gitnexus_registration_ambiguous', 'error', 'The repository name maps to multiple GitNexus registration paths.');
  if (registrations.status === 'unique') {
    const canonicalKey = canonical.path === null ? null : normalizeRepositoryPath(canonical.path);
    const registeredPath = registrations.paths[0];
    if (!registrations.currentPathRegistered && registeredPath !== canonicalKey) {
      addFinding(findings, 'gitnexus_registration_path_mismatch', 'error', 'The unique GitNexus registration matches neither the current nor the canonical checkout.', gitnexus.registrations.find((registration) => normalizeRepositoryPath(registration.path) === registeredPath)?.path ?? null);
    }
  }

  let indexFreshness = 'unknown';
  if (canonical.path !== null && gitnexus.indexed_path !== null
      && normalizeRepositoryPath(gitnexus.indexed_path) === normalizeRepositoryPath(canonical.path)
      && observation.current_checkout.origin_main_sha !== null) {
    indexFreshness = gitnexus.indexed_commit.toLowerCase() === observation.current_checkout.origin_main_sha.toLowerCase() ? 'fresh' : 'stale';
    if (indexFreshness === 'stale') {
      addFinding(findings, 'canonical_index_not_origin_main', 'error', 'The canonical GitNexus index commit does not match the observed origin/main commit.', gitnexus.indexed_path);
    }
  } else if (gitnexus.indexed_path !== null) {
    addFinding(findings, 'canonical_index_freshness_unknown', 'unknown', 'The observed GitNexus index is not bound to the identified canonical main checkout or origin/main is unknown.', gitnexus.indexed_path);
  }

  const currentKey = normalizeRepositoryPath(observation.current_checkout.path);
  const indexedKey = gitnexus.indexed_path === null ? null : normalizeRepositoryPath(gitnexus.indexed_path);
  let currentTrust = 'unknown';
  if (indexedKey === currentKey) {
    const commitMatches = gitnexus.indexed_commit?.toLowerCase() === observation.current_checkout.head_sha.toLowerCase();
    currentTrust = gitnexus.status === 'healthy' && gitnexus.fts_status === 'healthy' && commitMatches ? 'trusted' : 'untrusted';
    if (!commitMatches) addFinding(findings, 'current_index_commit_mismatch', 'error', 'The indexed commit does not match the current checkout HEAD.', gitnexus.indexed_path);
  } else {
    addFinding(findings, 'current_checkout_index_unknown', 'unknown', 'The current checkout has no exact-path GitNexus index observation; another worktree index cannot describe its diff.', observation.current_checkout.path);
  }

  return {
    status: gitnexus.status,
    indexed_path: gitnexus.indexed_path === null ? null : displayPath(gitnexus.indexed_path),
    indexed_commit: gitnexus.indexed_commit,
    index_freshness: indexFreshness,
    fts_status: gitnexus.fts_status,
    registration_status: registrations.status,
    registration_count: registrations.count,
    current_checkout_trust: currentTrust,
  };
}

export function evaluateGitNexusWorktreeHealth(observation) {
  validateGitNexusWorktreeObservation(observation);
  const findings = [];
  const manualActions = [];
  const currentKey = normalizeRepositoryPath(observation.current_checkout.path);
  const mainWorktrees = observation.worktrees.filter((worktree) => normalizeBranch(worktree.branch, 'worktree branch') === 'refs/heads/main');
  let canonicalStatus = 'identified';
  let canonicalWorktree = mainWorktrees[0] ?? null;
  if (mainWorktrees.length === 0) {
    canonicalStatus = 'missing';
    canonicalWorktree = null;
    addFinding(findings, 'canonical_checkout_missing', 'error', 'No registered worktree owns refs/heads/main.');
  } else if (mainWorktrees.length > 1) {
    canonicalStatus = 'ambiguous';
    canonicalWorktree = null;
    addFinding(findings, 'canonical_checkout_ambiguous', 'error', 'More than one registered worktree claims refs/heads/main.');
  }

  const canonicalPath = canonicalWorktree === null ? null : displayPath(canonicalWorktree.path);
  let canonicalMatchesOriginMain = null;
  if (canonicalWorktree !== null && observation.current_checkout.origin_main_sha !== null) {
    canonicalMatchesOriginMain = canonicalWorktree.head_sha.toLowerCase() === observation.current_checkout.origin_main_sha.toLowerCase();
    if (!canonicalMatchesOriginMain) addFinding(findings, 'canonical_checkout_not_origin_main', 'warning', 'The main worktree HEAD does not match the observed origin/main commit.', canonicalWorktree.path);
  } else if (observation.current_checkout.origin_main_sha === null) {
    addFinding(findings, 'origin_main_unknown', 'unknown', 'refs/remotes/origin/main was not available; no fetch was attempted.');
  }

  if (observation.current_checkout.dirty) addFinding(findings, 'current_checkout_dirty', 'warning', 'The current checkout has uncommitted changes.', observation.current_checkout.path);
  if (observation.current_checkout.branch === null) addFinding(findings, 'current_checkout_detached', 'warning', 'The current checkout is detached.', observation.current_checkout.path);

  const worktrees = observation.worktrees
    .map((worktree) => {
      const path = displayPath(worktree.path);
      const pathKey = normalizeRepositoryPath(path);
      const isCurrent = pathKey === currentKey;
      const isCanonical = canonicalPath !== null && pathKey === normalizeRepositoryPath(canonicalPath);
      const kind = worktreeKind(path, isCurrent, isCanonical);
      if (worktree.prunable) {
        addFinding(findings, 'worktree_prunable', 'warning', 'Git reports this worktree as prunable; inspect it before any cleanup.', path);
        if (kind !== 'deployment') {
          manualActions.push({
            action: 'inspect_then_remove_prunable_worktree',
            target: path,
            requires_authorization: true,
            command_argv: ['git', 'worktree', 'remove', path],
            preconditions: ['exact_target_verified', 'not_deployment', 'clean', 'merged', 'unowned'],
          });
        }
      }
      if (worktree.locked) addFinding(findings, 'worktree_locked', 'warning', 'This worktree is locked.', path);
      if (worktree.owner_status === 'ended') addFinding(findings, 'worktree_owner_ended', 'warning', 'The latest mapped agent-board owner has ended.', path);
      return {
        path,
        head_sha: worktree.head_sha,
        branch: normalizeBranch(worktree.branch, 'worktree branch'),
        dirty: worktree.dirty,
        detached: worktree.branch === null,
        locked: worktree.locked,
        prunable: worktree.prunable,
        owner: worktree.owner,
        owner_status: worktree.owner_status,
        last_activity: worktree.last_activity,
        is_current: isCurrent,
        is_canonical: isCanonical,
        kind,
      };
    })
    .sort((left, right) => normalizeRepositoryPath(left.path).localeCompare(normalizeRepositoryPath(right.path)));

  const canonical = {
    status: canonicalStatus,
    path: canonicalPath,
    head_sha: canonicalWorktree?.head_sha ?? null,
    matches_origin_main: canonicalMatchesOriginMain,
  };
  const gitnexus = buildGitNexusReport(observation, canonical, findings);
  const currentIsCanonical = canonicalPath !== null && normalizeRepositoryPath(canonicalPath) === currentKey;
  const report = {
    schema_version: REPORT_SCHEMA_VERSION,
    overall_status: overallStatus(findings),
    repository_name: observation.repository_name,
    current_checkout: {
      path: displayPath(observation.current_checkout.path),
      head_sha: observation.current_checkout.head_sha,
      origin_main_sha: observation.current_checkout.origin_main_sha,
      branch: normalizeBranch(observation.current_checkout.branch, 'current checkout branch'),
      dirty: observation.current_checkout.dirty,
      relationship: canonicalStatus !== 'identified' ? 'unknown' : currentIsCanonical ? 'canonical' : 'linked',
    },
    canonical_checkout: canonical,
    gitnexus,
    worktrees,
    manual_actions: manualActions.sort((left, right) => normalizeRepositoryPath(left.target).localeCompare(normalizeRepositoryPath(right.target))),
    findings: sortFindings(findings),
  };
  return report;
}

export const gitNexusWorktreeHealthVersions = Object.freeze({
  observation: OBSERVATION_SCHEMA_VERSION,
  report: REPORT_SCHEMA_VERSION,
});
