import {
  canonicalJson,
  equalText,
  fail,
  isPlainObject,
  safeInteger,
  sha256,
} from './trusted-host-merge-contract.mjs'


const cleanGitPath = (path) => {
  if (
    typeof path !== 'string' || !path || path.includes('\\') ||
    /[\u0000-\u001f\u007f\ufffd]/u.test(path) || path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    fail('scope_drift', 'git_path_invalid')
  }
  return path
}

export function parseNameStatusZ(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : value
  if (typeof text !== 'string' || !text.endsWith('\0')) {
    fail('scope_drift', 'name_status_not_nul_terminated')
  }
  const fields = text.split('\0')
  fields.pop()
  const entries = []
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]
    if (!/^(?:[ACDMRTUXB]|R[0-9]{1,3}|C[0-9]{1,3})$/u.test(status)) {
      fail('scope_drift', 'name_status_code_invalid')
    }
    if (/^[RC]/u.test(status)) {
      if (index + 1 >= fields.length) fail('scope_drift', 'rename_path_pair_missing')
      entries.push({ status, oldPath: cleanGitPath(fields[index++]), path: cleanGitPath(fields[index++]) })
    } else {
      if (index >= fields.length) fail('scope_drift', 'changed_path_missing')
      entries.push({ status, path: cleanGitPath(fields[index++]) })
    }
  }
  if (entries.length === 0) fail('scope_drift', 'empty_change_set')
  return entries
}

const elevatedPathPatterns = [
  /^(?:\.agents|\.claude|\.codex|\.github|agent-contracts|architecture|openspec|scripts|docs\/agents|infra)(?:\/|$)/u,
  /^(?:AGENTS\.md|CLAUDE\.md|agent-skills-manifest\.json)$/u,
  /(?:^|\/)(?:auth|permission|migration|migrations|production|deploy|deployment|destructive)(?:[._/-]|$)/iu,
]

export function classifyElevatedPaths(entries) {
  const paths = entries.flatMap((entry) => entry.oldPath ? [entry.oldPath, entry.path] : [entry.path])
  return {
    elevated: paths.some((path) => elevatedPathPatterns.some((pattern) => pattern.test(path))),
    paths,
  }
}

const emptyBypass = (value) => {
  if (value === undefined || value === null) return true
  if (!isPlainObject(value)) return false
  return ['users', 'teams', 'apps'].every((key) => !Array.isArray(value[key]) || value[key].length === 0)
}

export function verifyBranchProtection(protection, requiredCheckSources) {
  if (!isPlainObject(protection)) fail('branch_protection_single_owner_gate_not_strict', 'protection_missing')
  const status = protection.required_status_checks
  const reviews = protection.required_pull_request_reviews
  const contexts = Array.isArray(status?.contexts) ? status.contexts : []
  const checks = Array.isArray(status?.checks) ? status.checks : []
  if (status?.strict !== true || contexts.length === 0 || checks.length === 0) {
    fail('branch_protection_single_owner_gate_not_strict', 'required_checks_not_strict')
  }
  const normalizedChecks = checks.map((check) => {
    if (typeof check?.context !== 'string' || !check.context || !safeInteger(check.app_id)) {
      fail('branch_protection_single_owner_gate_not_strict', 'required_check_source_not_pinned')
    }
    return { context: check.context, appId: check.app_id }
  }).sort((a, b) => a.context.localeCompare(b.context) || a.appId - b.appId)
  const uniqueChecks = new Set(normalizedChecks.map((check) => `${check.context}\0${check.appId}`))
  if (uniqueChecks.size !== normalizedChecks.length || new Set(contexts).size !== contexts.length) {
    fail('branch_protection_single_owner_gate_not_strict', 'required_checks_not_unique')
  }
  const contextSet = [...new Set(normalizedChecks.map((check) => check.context))].sort()
  if (canonicalJson([...contexts].sort()) !== canonicalJson(contextSet)) {
    fail('branch_protection_single_owner_gate_not_strict', 'required_check_contexts_not_source_pinned')
  }
  if (!Array.isArray(requiredCheckSources) || requiredCheckSources.length === 0) {
    fail('branch_protection_single_owner_gate_not_strict', 'required_check_source_allowlist_unprovisioned')
  }
  const trustedChecks = requiredCheckSources.map((check) => ({ context: check?.context, appId: check?.app_id }))
    .sort((a, b) => String(a.context).localeCompare(String(b.context)) || Number(a.appId) - Number(b.appId))
  if (canonicalJson(trustedChecks) !== canonicalJson(normalizedChecks)) {
    fail('branch_protection_single_owner_gate_not_strict', 'required_check_source_allowlist_mismatch')
  }
  if (
    reviews?.required_approving_review_count !== 1 || reviews?.dismiss_stale_reviews !== true ||
    reviews?.require_code_owner_reviews !== true || !emptyBypass(reviews?.bypass_pull_request_allowances) ||
    protection.required_conversation_resolution?.enabled !== true ||
    protection.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled !== false ||
    protection.allow_deletions?.enabled !== false
  ) {
    fail('branch_protection_single_owner_gate_not_strict', 'single_owner_protection_not_strict')
  }
  return {
    strict: true,
    requiredChecks: normalizedChecks,
    requiredApprovals: 1,
    dismissStaleReviews: true,
    requireCodeOwnerReviews: true,
    conversationResolution: true,
    enforceAdmins: true,
    allowForcePushes: false,
    allowDeletions: false,
  }
}

export function verifyRulesets(rulesets) {
  if (!Array.isArray(rulesets)) fail('branch_protection_single_owner_gate_not_strict', 'rulesets_missing')
  return rulesets.filter((ruleset) => ruleset?.enforcement === 'active').map((ruleset) => {
    if (!safeInteger(ruleset.id) || !Array.isArray(ruleset.bypass_actors) || ruleset.bypass_actors.length !== 0) {
      fail('branch_protection_single_owner_gate_not_strict', 'active_ruleset_bypass_or_shape_invalid')
    }
    return {
      id: ruleset.id,
      name: ruleset.name,
      target: ruleset.target,
      enforcement: ruleset.enforcement,
      conditions: ruleset.conditions,
      rules: ruleset.rules,
      bypassActors: [],
    }
  }).sort((a, b) => a.id - b.id)
}

export function verifyPullRequestIdentity(pr, invocation, { final = false } = {}) {
  if (
    !isPlainObject(pr) || pr.number !== invocation.prNumber || pr.state !== 'open' ||
    pr.draft !== false || pr.merged !== false || pr.head?.sha !== invocation.headOid ||
    typeof pr.head?.ref !== 'string' || !pr.head.ref ||
    pr.head?.repo?.full_name !== invocation.repo || pr.base?.sha !== invocation.baseOid ||
    pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== invocation.repo
  ) {
    fail('pr_identity_not_ready', 'pull_request_identity_mismatch')
  }
  if (/^(?:revert-|release(?:[-/]|$)|hotfix(?:[-/]|$))/iu.test(pr.head.ref)) {
    fail('branch_requires_separate_authorization', 'restricted_head_branch')
  }
  if (pr.reviewDecision !== 'APPROVED') fail('review_required', 'review_decision_not_approved')
  if (final && pr.mergeStateStatus !== 'CLEAN') fail('final_gate_not_clean', 'merge_state_not_clean')
}

export function bindRawBranchProtection(protection) {
  if (!isPlainObject(protection)) {
    fail('branch_protection_single_owner_gate_not_strict', 'protection_missing')
  }
  return JSON.parse(canonicalJson(protection))
}

export function canonicalHumanApprovalBody(invocation) {
  return JSON.stringify({
    kind: 'ai-bim-single-owner-approval',
    version: 1,
    repo: invocation.repo,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    action: invocation.action,
  })
}

export function selectCanonicalApproval(reviews, invocation, contract) {
  const expectedBody = canonicalHumanApprovalBody(invocation)
  const reviewer = contract.broker.required_reviewer
  const matches = Array.isArray(reviews) ? reviews.filter((review) => (
    review?.state === 'APPROVED' && review?.commit_id === invocation.headOid &&
    equalText(review?.body, expectedBody) && review?.user?.login === reviewer.login &&
    review?.user?.id === reviewer.id && review?.user?.type === reviewer.type &&
    review?.author_association === 'COLLABORATOR' &&
    typeof review?.submitted_at === 'string' && review.submitted_at.length > 0 &&
    safeInteger(review?.id) && typeof review?.node_id === 'string' && review.node_id.length > 0
  )) : []
  if (matches.length !== 1) fail('human_approval_required', 'canonical_approval_not_unique')
  const match = matches[0]
  return { id: match.id, nodeId: match.node_id, body: match.body, commitId: match.commit_id }
}

export function verifyReviewerPermission(permission, contract) {
  const expected = contract.broker.required_reviewer
  if (
    permission?.user?.login !== expected.login || permission?.user?.id !== expected.id ||
    permission?.user?.type !== expected.type || permission?.permission !== expected.permission ||
    permission?.role_name !== expected.role_name
  ) {
    fail('reviewer_permission_not_strict', 'reviewer_live_permission_mismatch')
  }
}

const acceptedCheckConclusions = new Set(['success', 'neutral', 'skipped'])

export function verifyRequiredChecks(checkRuns, protectionSnapshot, headOid) {
  if (!Array.isArray(checkRuns)) fail('final_gate_read_failed', 'check_runs_missing')
  for (const requirement of protectionSnapshot.requiredChecks) {
    const candidates = checkRuns.filter((run) => (
      run?.name === requirement.context && run?.app?.id === requirement.appId && run?.head_sha === headOid
    )).sort((a, b) => Number(b.id) - Number(a.id))
    const latest = candidates[0]
    if (!latest || latest.status !== 'completed' || !acceptedCheckConclusions.has(latest.conclusion)) {
      fail('final_gate_not_clean', 'required_check_not_green')
    }
  }
}

const surfaceFields = [
  'id', 'node_id', 'body', 'state', 'commit_id', 'author_association',
  'created_at', 'updated_at', 'submitted_at', 'path', 'position', 'line', 'side',
]

export function normalizeReviewSurface(items) {
  if (!Array.isArray(items)) fail('final_gate_read_failed', 'review_surface_missing')
  return items.map((item) => {
    const normalized = {}
    for (const field of surfaceFields) {
      if (item?.[field] !== undefined) normalized[field] = item[field]
    }
    if (item?.user) normalized.user = { id: item.user.id, login: item.user.login, type: item.user.type }
    return normalized
  }).sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }))
}

export function reviewSurfaceSnapshot(surface) {
  const normalized = {
    pullComments: normalizeReviewSurface(surface.pullComments),
    reviews: normalizeReviewSurface(surface.reviews),
    issueComments: normalizeReviewSurface(surface.issueComments),
  }
  return { normalized, sha256: sha256(canonicalJson(normalized)) }
}
