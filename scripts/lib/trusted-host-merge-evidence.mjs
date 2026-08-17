import {
  canonicalJson,
  equalText,
  exactKeys,
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

export function parseNumstatZ(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : value
  if (typeof text !== 'string' || !text.endsWith('\0')) {
    fail('scope_drift', 'numstat_not_nul_terminated')
  }
  const records = text.split('\0')
  records.pop()
  if (records.length === 0) fail('scope_drift', 'numstat_empty')
  return records.map((record) => {
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 1 || secondTab <= firstTab + 1) {
      fail('scope_drift', 'numstat_record_invalid')
    }
    const added = record.slice(0, firstTab)
    const deleted = record.slice(firstTab + 1, secondTab)
    if (!((/^\d+$/u.test(added) && /^\d+$/u.test(deleted)) || (added === '-' && deleted === '-'))) {
      fail('scope_drift', 'numstat_counts_invalid')
    }
    return {
      added,
      deleted,
      path: cleanGitPath(record.slice(secondTab + 1)),
      binary: added === '-',
    }
  })
}

export function rejectBinaryDiff(numstatEntries) {
  if (!Array.isArray(numstatEntries) || numstatEntries.length === 0) {
    fail('scope_drift', 'numstat_entries_missing')
  }
  if (numstatEntries.some((entry) => entry?.binary === true)) {
    fail('scope_drift', 'binary_diff_forbidden')
  }
}

export function decodeLosslessGitDiff(value) {
  if (!Buffer.isBuffer(value)) fail('scope_drift', 'git_diff_bytes_missing')
  if (value.includes(0)) fail('scope_drift', 'binary_diff_forbidden')
  const text = value.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(value)) {
    fail('scope_drift', 'non_utf8_diff_forbidden')
  }
  return text
}

export function verifyInspectableGitBlobs(rawEntries, readBlob) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0 || typeof readBlob !== 'function') {
    fail('scope_drift', 'raw_diff_entries_missing')
  }
  const blobOids = new Set()
  for (const entry of rawEntries) {
    for (const side of ['old', 'new']) {
      const mode = entry?.[`${side}Mode`]
      const oid = entry?.[`${side}Oid`]
      if (mode === '000000') continue
      if (!/^[0-9a-f]{40}$/u.test(oid) || /^0{40}$/u.test(oid)) {
        fail('scope_drift', 'raw_diff_blob_oid_invalid')
      }
      blobOids.add(oid)
    }
  }
  for (const oid of blobOids) {
    const blob = readBlob(oid)
    if (!Buffer.isBuffer(blob)) fail('scope_drift', 'git_blob_bytes_missing')
    if (blob.includes(0)) fail('scope_drift', 'binary_diff_forbidden')
    const text = blob.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(blob)) {
      fail('scope_drift', 'non_utf8_diff_forbidden')
    }
  }
}

export function parseRawDiffZ(value) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : value
  if (typeof text !== 'string' || !text.endsWith('\0')) {
    fail('scope_drift', 'raw_diff_not_nul_terminated')
  }
  const fields = text.split('\0')
  fields.pop()
  if (fields.length === 0 || fields.length % 2 !== 0) fail('scope_drift', 'raw_diff_record_invalid')
  const entries = []
  for (let index = 0; index < fields.length; index += 2) {
    const metadata = fields[index]
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMTUXB])$/u.exec(metadata)
    if (!match) fail('scope_drift', 'raw_diff_metadata_invalid')
    entries.push({
      oldMode: match[1],
      newMode: match[2],
      oldOid: match[3],
      newOid: match[4],
      status: match[5],
      path: cleanGitPath(fields[index + 1]),
    })
  }
  return entries
}

export function rejectOpaqueGitModes(rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    fail('scope_drift', 'raw_diff_entries_missing')
  }
  const inspectableModes = new Set(['000000', '100644', '100755'])
  if (rawEntries.some((entry) => (
    !inspectableModes.has(entry?.oldMode) || !inspectableModes.has(entry?.newMode)
  ))) {
    fail('scope_drift', 'opaque_git_mode_forbidden')
  }
}

const elevatedPathPatterns = [
  /^(?:\.agents|\.claude|\.codex|\.github|agent-contracts|architecture|openspec|scripts|docs\/agents|infra)(?:\/|$)/u,
  /^(?:AGENTS\.md|CLAUDE\.md|agent-skills-manifest\.json)$/u,
  /^(?:.*\/)?\.gitattributes$/u,
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
  if (!exactKeys(value, ['users', 'teams', 'apps'])) return false
  return ['users', 'teams', 'apps'].every((key) => Array.isArray(value[key]) && value[key].length === 0)
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
    requiredChecks: normalizedChecks.map((check) => {
      const source = requiredCheckSources.find((candidate) => (
        candidate?.context === check.context && candidate?.app_id === check.appId
      ))
      if (
        typeof source?.verification_target !== 'string' || !source.verification_target ||
        typeof source?.workflow_path !== 'string' || !source.workflow_path
      ) {
        fail('branch_protection_single_owner_gate_not_strict', 'required_check_verification_target_missing')
      }
      return {
        ...check,
        verificationTarget: source.verification_target,
        workflowPath: source.workflow_path,
      }
    }),
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

export function bindVerifiedPullRequestIdentity(pr) {
  return {
    number: pr.number,
    state: pr.state,
    draft: pr.draft,
    merged: pr.merged,
    head: {
      sha: pr.head.sha,
      ref: pr.head.ref,
      repo: { full_name: pr.head.repo.full_name },
    },
    base: {
      sha: pr.base.sha,
      ref: pr.base.ref,
      repo: { full_name: pr.base.repo.full_name },
    },
    body: typeof pr.body === 'string' ? pr.body : '',
    gates: {
      reviewDecisionApproved: true,
      mergeStateClean: true,
    },
  }
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

export function canonicalAutomatedApproveOnlyBody(invocation) {
  return JSON.stringify({
    kind: 'ai-bim-automated-approve-only',
    version: 1,
    automated: true,
    repo: invocation.repo,
    prNumber: invocation.prNumber,
    headOid: invocation.headOid,
    baseOid: invocation.baseOid,
    action: 'approve-only',
  })
}

export function selectCanonicalApproval(reviews, invocation, contract) {
  const expectedBody = canonicalHumanApprovalBody(invocation)
  const approveOnlyBody = canonicalAutomatedApproveOnlyBody(invocation)
  const reviewer = contract.broker.required_reviewer
  const matches = Array.isArray(reviews) ? reviews.filter((review) => (
    review?.state === 'APPROVED' && review?.commit_id === invocation.headOid &&
    !equalText(review?.body, approveOnlyBody) && equalText(review?.body, expectedBody) &&
    review?.user?.login === reviewer.login &&
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

export function verifyRequiredChecks(
  checkRuns,
  workflowRuns,
  protectionSnapshot,
  invocation,
  verificationPlan,
  verificationTargetSources,
) {
  if (!Array.isArray(checkRuns)) fail('final_gate_read_failed', 'check_runs_missing')
  if (!Array.isArray(workflowRuns)) fail('final_gate_read_failed', 'workflow_runs_missing')
  const headOid = invocation?.headOid
  if (
    verificationPlan?.schema_version !== 'verification-plan/v2' ||
    verificationPlan?.result !== 'planned' || verificationPlan?.subject_sha !== headOid ||
    !Array.isArray(verificationPlan?.targets)
  ) {
    fail('final_gate_read_failed', 'trusted_base_verification_plan_invalid')
  }
  const targetById = new Map(verificationPlan.targets.map((target) => [target?.id, target]))
  if (targetById.size !== verificationPlan.targets.length) {
    fail('final_gate_read_failed', 'trusted_base_verification_plan_invalid')
  }
  if (!Array.isArray(verificationTargetSources)) {
    fail('final_gate_read_failed', 'verification_target_source_registry_invalid')
  }
  const sourceByTarget = new Map()
  for (const source of verificationTargetSources) {
    if (
      !exactKeys(source, ['context', 'app_id', 'verification_target', 'workflow_path']) ||
      typeof source.context !== 'string' || source.context.length === 0 ||
      !safeInteger(source.app_id) ||
      typeof source.verification_target !== 'string' ||
      typeof source.workflow_path !== 'string' || source.workflow_path.length === 0 ||
      sourceByTarget.has(source.verification_target)
    ) {
      fail('final_gate_read_failed', 'verification_target_source_registry_invalid')
    }
    sourceByTarget.set(source.verification_target, {
      context: source.context,
      appId: source.app_id,
      verificationTarget: source.verification_target,
      workflowPath: source.workflow_path,
    })
  }
  if (
    sourceByTarget.size !== targetById.size ||
    [...targetById].some(([targetId, target]) => (
      !sourceByTarget.has(targetId) || sourceByTarget.get(targetId).context !== target?.ci_job
    ))
  ) {
    fail('final_gate_read_failed', 'verification_target_source_coverage_invalid')
  }
  const repositoryName = invocation?.repo?.split('/')[1]
  const exactRepository = (repository) => (
    typeof repositoryName === 'string' && repositoryName.length > 0 &&
    repository?.url === `https://api.github.com/repos/${invocation.repo}` &&
    repository?.name === repositoryName &&
    (repository?.full_name === undefined || repository.full_name === invocation.repo)
  )
  const requirements = new Map()
  for (const requirement of sourceByTarget.values()) {
    requirements.set(canonicalJson(requirement), requirement)
  }
  if (!Array.isArray(protectionSnapshot?.requiredChecks)) {
    fail('final_gate_read_failed', 'required_check_sources_missing')
  }
  for (const requirement of protectionSnapshot.requiredChecks) {
    if (!targetById.has(requirement?.verificationTarget)) {
      fail('final_gate_read_failed', 'required_check_verification_target_unknown')
    }
    requirements.set(canonicalJson(requirement), requirement)
  }

  const verified = []
  for (const requirement of requirements.values()) {
    const candidates = checkRuns.filter((run) => (
      run?.name === requirement.context && run?.app?.id === requirement.appId && run?.head_sha === headOid
    ))
    if (candidates.some((run) => !safeInteger(run?.id))) {
      fail('final_gate_read_failed', 'required_check_run_id_invalid')
    }
    candidates.sort((a, b) => b.id - a.id)
    const target = targetById.get(requirement.verificationTarget)
    if (!target || typeof target.required !== 'boolean') {
      fail('final_gate_read_failed', 'required_check_verification_target_unknown')
    }
    const selected = target.required
      ? candidates.find((run) => run?.conclusion !== 'skipped')
      : candidates[0]
    const accepted = target.required
      ? selected?.conclusion === 'success'
      : ['success', 'skipped'].includes(selected?.conclusion)
    if (!selected || selected.status !== 'completed' || !accepted) {
      fail('final_gate_not_clean', 'required_check_not_green')
    }
    const checkSuiteId = selected?.check_suite?.id
    if (!safeInteger(checkSuiteId) || typeof selected?.details_url !== 'string') {
      fail('final_gate_read_failed', 'required_check_workflow_provenance_missing')
    }
    const matchingWorkflowRuns = workflowRuns.filter((run) => run?.check_suite_id === checkSuiteId)
    if (matchingWorkflowRuns.length !== 1) {
      fail('final_gate_read_failed', 'required_check_workflow_provenance_ambiguous')
    }
    const workflowRun = matchingWorkflowRuns[0]
    const exactPullRequest = Array.isArray(workflowRun?.pull_requests) && workflowRun.pull_requests.some((item) => (
      item?.number === invocation.prNumber && item?.head?.sha === headOid &&
      exactRepository(item?.head?.repo) && item?.base?.sha === invocation.baseOid &&
      item?.base?.ref === 'main' && exactRepository(item?.base?.repo)
    ))
    const detailsPrefix = `https://github.com/${invocation.repo}/actions/runs/${workflowRun?.id}/job/`
    if (
      !safeInteger(workflowRun?.id) || !safeInteger(workflowRun?.run_attempt) ||
      workflowRun?.path !== requirement.workflowPath || workflowRun?.event !== 'pull_request' ||
      workflowRun?.head_sha !== headOid || !exactRepository(workflowRun?.repository) ||
      !exactRepository(workflowRun?.head_repository) || !exactPullRequest ||
      !selected.details_url.startsWith(detailsPrefix) ||
      !/^[0-9]+$/u.test(selected.details_url.slice(detailsPrefix.length))
    ) {
      fail('final_gate_read_failed', 'required_check_workflow_provenance_invalid')
    }
    verified.push({
      context: requirement.context,
      appId: requirement.appId,
      verificationTarget: requirement.verificationTarget,
      workflowPath: requirement.workflowPath,
      targetRequired: target.required,
      runId: selected.id,
      checkSuiteId,
      workflowRunId: workflowRun.id,
      workflowRunAttempt: workflowRun.run_attempt,
      status: selected.status,
      conclusion: selected.conclusion,
    })
  }
  return verified
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
