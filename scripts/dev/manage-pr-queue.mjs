#!/usr/bin/env node
// Explicit, named-PR queue helper. Lifecycle hooks never mutate GitHub state.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildGitArgs,
  buildIsolatedGitEnv,
} from './agents-board-path.mjs';
import { triggerOrphanCleanup } from './cleanup-orphan-dev-processes.mjs';
import { acquirePrQueueLock } from './pr-queue-lock.mjs';
import { buildReviewDispositionReply } from '../lib/autonomous-delivery-finalization.mjs';
import { loadAutonomousCodexReviewPolicy } from '../lib/autonomous-codex-review-check.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..', '..');
const GITHUB_HOST = 'github.com';
const GITHUB_REPO = `${GITHUB_HOST}/monkey1sai/AI-BIM-governance`;
const GITHUB_OWNER = 'monkey1sai';
const GITHUB_NAME = 'AI-BIM-governance';
const LEGACY_GUARDED_PHASE = 'LEGACY_GUARDED';
const PR_VIEW_JSON_FIELDS = 'number,title,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,reviewDecision,isDraft,state,url,autoMergeRequest';
const PR_CHECKS_JSON_FIELDS = 'name,state,bucket,workflow,link';
const PR_OBSERVATION_FIELDS = Object.freeze(PR_VIEW_JSON_FIELDS.split(','));
const UNRESOLVED_THREADS_QUERY = [
  'query($owner:String!,$name:String!,$number:Int!){',
  'repository(owner:$owner,name:$name){pullRequest(number:$number){',
  'reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}',
  '}}}',
].join('');
const EXACT_HEAD_APPROVAL_QUERY = [
  'query($owner:String!,$name:String!,$number:Int!){',
  'repository(owner:$owner,name:$name){pullRequest(number:$number){',
  'reviews(first:100){nodes{state author{login __typename ... on User {databaseId}} commit{oid}}pageInfo{hasNextPage}}',
  '}}}',
].join('');

function exactArgs(actual, expected) {
  return (
    Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index])
  );
}

function buildIsolatedGitHubEnv(env = process.env) {
  return Object.fromEntries(
    Object.entries(env || {}).filter(([key]) => (
      !/^(?:GH_HOST|GH_REPO|GH_CONFIG_DIR|XDG_CONFIG_HOME)$/i.test(key)
    )),
  );
}

export function classifyQueueCommand(command, args) {
  const prNumber = String(args?.[2] || '');
  const validPrNumber = /^[1-9]\d*$/.test(prNumber);
  if (command === 'git') {
    const allowed = (
      exactArgs(args, ['rev-parse', 'HEAD'])
      || exactArgs(args, ['rev-parse', 'origin/main'])
    );
    return { allowed, reason: allowed ? 'allowlisted_git_read' : 'git_command_not_allowlisted' };
  }
  if (command !== 'gh') {
    return { allowed: false, reason: 'executable_not_allowlisted' };
  }
  if (
    validPrNumber
    && exactArgs(args, [
      'pr', 'view', prNumber, '--json', PR_VIEW_JSON_FIELDS, '--repo', GITHUB_REPO,
    ])
  ) return { allowed: true, reason: 'allowlisted_pr_view' };
  if (
    validPrNumber
    && exactArgs(args, [
      'pr', 'checks', prNumber, '--required', '--json', PR_CHECKS_JSON_FIELDS,
      '--repo', GITHUB_REPO,
    ])
  ) return { allowed: true, reason: 'allowlisted_pr_checks' };
  const queryValue = String(args?.[3] || '');
  const graphqlNumber = String(args?.[9] || '');
  const validGraphqlNumber = /^[1-9]\d*$/.test(graphqlNumber.replace(/^number=/, ''));
  const graphqlShape = [
    'api', 'graphql', '-f', queryValue,
    '-F', `owner=${GITHUB_OWNER}`,
    '-F', `name=${GITHUB_NAME}`,
    '-F', graphqlNumber,
    '--hostname', GITHUB_HOST,
  ];
  const allowedGraphqlQuery = (
    queryValue === `query=${UNRESOLVED_THREADS_QUERY}`
    || queryValue === `query=${EXACT_HEAD_APPROVAL_QUERY}`
  );
  if (validGraphqlNumber && allowedGraphqlQuery && exactArgs(args, graphqlShape)) {
    return { allowed: true, reason: 'allowlisted_graphql_query' };
  }
  return { allowed: false, reason: 'github_command_not_allowlisted' };
}

export function runCommand(
  command,
  args,
  cwd = SCRIPT_REPO_ROOT,
  {
    silent = false,
    execFileSyncImpl = execFileSync,
    env = process.env,
  } = {},
) {
  const policy = classifyQueueCommand(command, args);
  if (!policy.allowed) {
    const stderr = `[manage-pr-queue] denied ${command}: ${policy.reason}`;
    if (!silent) process.stderr.write(`${stderr}\n`);
    return { ok: false, stdout: '', stderr, exitCode: 2 };
  }
  try {
    const effectiveArgs = command === 'git' ? buildGitArgs(args) : args;
    const effectiveEnv = command === 'git'
      ? buildIsolatedGitEnv(env)
      : buildIsolatedGitHubEnv(env);
    const stdout = execFileSyncImpl(command, effectiveArgs, {
      cwd,
      encoding: 'utf8',
      env: effectiveEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.trim(), stderr: '', exitCode: 0 };
  } catch (error) {
    const stdout = String(error?.stdout || '').trim();
    const stderr = String(error?.stderr || error?.message || '').trim();
    if (!silent) {
      process.stderr.write(`[manage-pr-queue] ${command} ${args.join(' ')} failed\n${stderr}\n`);
    }
    return {
      ok: false,
      stdout,
      stderr,
      exitCode: Number(error?.status ?? 1),
    };
  }
}

function run(command, args, cwd = SCRIPT_REPO_ROOT, silent = false) {
  const result = runCommand(command, args, cwd, { silent });
  return result.ok ? result.stdout : null;
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function requirePrNumber(args) {
  const index = args.indexOf('--pr');
  const value = index >= 0 ? Number(args[index + 1]) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function getPrSnapshot(prNumber) {
  const raw = run(
    'gh',
    [
      'pr', 'view', String(prNumber), '--json',
      PR_VIEW_JSON_FIELDS,
      '--repo', GITHUB_REPO,
    ],
    SCRIPT_REPO_ROOT,
    true,
  );
  return raw ? parseJson(raw, null) : null;
}

export function getOriginMainSha() {
  return run('git', ['rev-parse', 'origin/main'], SCRIPT_REPO_ROOT, true);
}

export function getPrChecks(prNumber) {
  const result = runCommand(
    'gh',
    ['pr', 'checks', String(prNumber), '--required', '--json', PR_CHECKS_JSON_FIELDS, '--repo', GITHUB_REPO],
    SCRIPT_REPO_ROOT,
    { silent: true },
  );
  const details = parseJson(result.stdout, []);
  if (!Array.isArray(details)) {
    return { allGreen: false, pending: 0, failed: 1, passed: 0, details: [] };
  }
  let pending = 0;
  let failed = 0;
  let passed = 0;
  for (const check of details) {
    const bucket = String(check.bucket || '').toLowerCase();
    if (bucket === 'pass') passed += 1;
    else if (bucket === 'pending') pending += 1;
    else failed += 1;
  }
  return {
    allGreen: result.ok && details.length > 0 && failed === 0 && pending === 0,
    pending,
    failed,
    passed,
    details,
  };
}

export function getUnresolvedThreadCount(prNumber) {
  const raw = run(
    'gh',
    [
      'api', 'graphql',
      '-f', `query=${UNRESOLVED_THREADS_QUERY}`,
      '-F', `owner=${GITHUB_OWNER}`,
      '-F', `name=${GITHUB_NAME}`,
      '-F', `number=${prNumber}`,
      '--hostname', GITHUB_HOST,
    ],
    SCRIPT_REPO_ROOT,
    true,
  );
  const connection = raw
    ? parseJson(raw, {})?.data?.repository?.pullRequest?.reviewThreads
    : null;
  if (!connection || connection.pageInfo?.hasNextPage) {
    return { count: null, complete: false };
  }
  return {
    count: connection.nodes.filter((thread) => !thread.isResolved).length,
    complete: true,
  };
}

export function getExactHeadApproval(prNumber, expectedHeadSha) {
  return {
    count: 0,
    complete: false,
    reviewers: [],
    reason: 'HELD_REPOSITORY_APPROVAL_POLICY',
  };
}

export function updateBranch(prNumber, expectedHeadRef = '') {
  process.stderr.write(
    `[manage-pr-queue] HELD PR #${prNumber}: branch mutation is outside this read-only helper${expectedHeadRef ? ` (${expectedHeadRef})` : ''}.\n`,
  );
  return false;
}

export function approvePr(prNumber) {
  process.stderr.write(
    `[manage-pr-queue] HELD PR #${prNumber}: automated counted approval is retired; activate the source-pinned, App-ID-pinned replacement AI CheckRun.\n`,
  );
  return false;
}

export function validatePrPreflight(prNumber) {
  const pr = getPrSnapshot(prNumber);
  const localHead = run('git', ['rev-parse', 'HEAD'], SCRIPT_REPO_ROOT, true);
  if (!pr || !localHead || localHead !== pr.headRefOid) {
    process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: local HEAD is not the exact PR head.\n`);
    return false;
  }
  process.stderr.write(
    `[manage-pr-queue] HELD PR #${prNumber}: executable preflight is external to this read-only observer.\n`,
  );
  return false;
}

const heldReviewGate = (reason, phase = 'UNKNOWN') => Object.freeze({
  phase,
  disposition: 'HELD',
  countedReviewRequired: true,
  allowsMerge: false,
  reasons: Object.freeze([reason]),
});

export function inspectCanonicalReviewGate(...callerArguments) {
  if (callerArguments.length !== 0) {
    return heldReviewGate('canonical_review_policy_override_forbidden');
  }
  let policy;
  try {
    policy = loadAutonomousCodexReviewPolicy();
  } catch {
    return heldReviewGate('canonical_review_policy_unavailable');
  }
  if (
    policy.phase !== LEGACY_GUARDED_PHASE
    || policy.legacy_gate?.counted_review_required !== true
    || policy.legacy_gate?.direct_stack !== 'HELD'
  ) {
    return heldReviewGate('canonical_review_policy_invalid', policy.phase);
  }
  return Object.freeze({
    phase: policy.phase,
    disposition: LEGACY_GUARDED_PHASE,
    countedReviewRequired: true,
    allowsMerge: false,
    reasons: Object.freeze(['legacy_counted_review_required']),
  });
}

export function evaluateMergeReadiness({ pr, checks, threads, approval, expectedHeadSha }) {
  const canonicalGate = inspectCanonicalReviewGate();
  const reasons = [];
  if (canonicalGate.disposition === 'HELD') reasons.push(...canonicalGate.reasons);
  if (!pr || pr.state !== 'OPEN') reasons.push('pr_not_open');
  if (pr?.baseRefName !== 'main') reasons.push('base_not_main');
  if (pr?.isDraft) reasons.push('draft');
  if (!expectedHeadSha || pr?.headRefOid !== expectedHeadSha) reasons.push('head_mismatch');
  if (pr?.mergeable !== 'MERGEABLE') reasons.push('not_mergeable');
  if (pr?.mergeStateStatus === 'BEHIND') reasons.push('behind_main');
  else if (pr?.mergeStateStatus !== 'CLEAN') reasons.push('merge_state_not_clean');
  if (pr?.reviewDecision !== 'APPROVED') reasons.push('approval_missing');
  if (pr && !Object.hasOwn(pr, 'autoMergeRequest')) reasons.push('auto_merge_state_unknown');
  else if (pr?.autoMergeRequest != null) reasons.push('auto_merge_active');
  if (!checks?.allGreen) reasons.push('required_checks_not_green');
  if (!threads?.complete) reasons.push('thread_state_unknown');
  else if (threads.count !== 0) reasons.push('unresolved_threads');
  if (!approval?.complete) reasons.push('exact_head_approval_unknown');
  else if (approval.count < 1) reasons.push('exact_head_approval_missing');
  const observedReady = reasons.length === 0;
  reasons.push('canonical_merge_authority_external');
  return {
    ready: false,
    observedReady,
    phase: canonicalGate.phase,
    countedReviewRequired: canonicalGate.countedReviewRequired,
    reasons,
  };
}

export function isSamePrObservation(initial, final) {
  return Boolean(
    initial
    && final
    && PR_OBSERVATION_FIELDS.every((field) => initial[field] === final[field]),
  );
}

export function mergePr(prNumber, expectedHeadSha = '') {
  process.stderr.write(
    `[manage-pr-queue] HELD PR #${prNumber}: native merge is coordinator-owned and requires the canonical exact-tuple authority gate${expectedHeadSha ? ` (${expectedHeadSha})` : ''}.\n`,
  );
  return false;
}

function printStatus(prNumber, asJson = false) {
  const originMain = getOriginMainSha();
  const prs = [getPrSnapshot(prNumber)].filter(Boolean);
  const report = prs.map((pr) => {
    const checks = getPrChecks(pr.number);
    return {
      number: pr.number,
      title: pr.title,
      branch: pr.headRefName,
      baseSha: pr.baseRefOid || null,
      headSha: pr.headRefOid || null,
      mergeStateStatus: pr.mergeStateStatus || 'UNKNOWN',
      reviewDecision: pr.reviewDecision || 'PENDING',
      ciAllGreen: checks.allGreen,
      ciSummary: { passed: checks.passed, pending: checks.pending, failed: checks.failed },
    };
  });
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ originMain, prs: report }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`=== Named PR Queue Status (origin/main: ${originMain?.slice(0, 7) || 'unknown'}) ===\n`);
  for (const item of report) {
    process.stdout.write(`#${item.number} [${item.reviewDecision}] [${item.mergeStateStatus}] ${item.title}\n`);
    process.stdout.write(`    ${item.branch} head=${item.headSha?.slice(0, 7) || 'unknown'} CI=${JSON.stringify(item.ciSummary)}\n`);
  }
  if (report.length === 0) process.stdout.write('No matching open PR.\n');
}

export async function runQueue({ prNumber, auto = false } = {}) {
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) {
    process.stderr.write('[manage-pr-queue] run-queue requires --pr <number>.\n');
    return false;
  }
  const lock = acquirePrQueueLock({ repoRoot: SCRIPT_REPO_ROOT });
  if (!lock) {
    process.stdout.write('[manage-pr-queue] Another named PR queue worker is active; skipped.\n');
    return false;
  }
  try {
    triggerOrphanCleanup(true);
    const pr = getPrSnapshot(prNumber);
    if (!pr || pr.state !== 'OPEN') return false;
    if (pr.mergeStateStatus === 'BEHIND') {
      process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: behind main; update requires an external exact-head CAS action.\n`);
      return false;
    }
    const checks = getPrChecks(prNumber);
    const threads = getUnresolvedThreadCount(prNumber);
    const approval = getExactHeadApproval(prNumber, pr.headRefOid);
    const finalPr = getPrSnapshot(prNumber);
    if (!isSamePrObservation(pr, finalPr)) {
      process.stderr.write(
        `[manage-pr-queue] HELD PR #${prNumber}: pr_observation_changed\n`,
      );
      return false;
    }
    process.stdout.write(
      `#${finalPr.number} [${finalPr.reviewDecision || 'PENDING'}] `
      + `[${finalPr.mergeStateStatus || 'UNKNOWN'}] ${finalPr.title}\n`
      + `    ${finalPr.headRefName} head=${finalPr.headRefOid?.slice(0, 7) || 'unknown'} `
      + `CI=${JSON.stringify({ passed: checks.passed, pending: checks.pending, failed: checks.failed })}\n`,
    );
    const readiness = evaluateMergeReadiness({
      pr: finalPr,
      checks,
      threads,
      approval,
      expectedHeadSha: pr.headRefOid,
    });
    if (auto) {
      process.stderr.write('[manage-pr-queue] --auto is compatibility-only; GitHub mutation remains disabled.\n');
    }
    process.stderr.write(
      `[manage-pr-queue] HELD PR #${prNumber}: ${readiness.reasons.join(', ')}\n`,
    );
    return false;
  } finally {
    triggerOrphanCleanup(true);
    lock.release();
  }
}

const DISPOSITION_PACKET_SCHEMA = 'ai-bim-review-disposition-packet/v1';
const DISPOSITION_PLAN_SCHEMA = 'ai-bim-review-disposition-plan/v1';

// Review Disposition Agent, observer half. The merge-queue agent renders one
// structured reply per finding, bound to the exact PR tuple just read from
// GitHub. Pure and mutation-free: posting is a separate coordinator sink
// (scripts/dev/post-review-disposition.mjs) that re-reads the head again.
export function buildReviewDispositionPlan(packet, snapshot, { now = new Date() } = {}) {
  const held = (reason) => ({ schemaVersion: DISPOSITION_PLAN_SCHEMA, status: 'HELD', reason, replies: [] });
  if (!packet || typeof packet !== 'object' || packet.schemaVersion !== DISPOSITION_PACKET_SCHEMA) {
    return held('disposition_packet_schema_invalid');
  }
  if (!Array.isArray(packet.findings) || packet.findings.length === 0 || packet.findings.length > 256) {
    return held('disposition_packet_findings_missing_or_unbounded');
  }
  if (packet.repository !== `${GITHUB_OWNER}/${GITHUB_NAME}`) return held('packet_repository_not_supported');
  if (!snapshot || snapshot.state !== 'OPEN') return held('pr_not_open');
  if (snapshot.isDraft === true) return held('pr_is_draft');
  if (snapshot.baseRefName !== 'main') return held('base_not_main');
  if (snapshot.number !== packet.prNumber) return held('packet_pr_mismatch');
  if (snapshot.headRefOid !== packet.headOid || snapshot.baseRefOid !== packet.baseOid) return held('exact_head_drift');
  const replies = [];
  const seenFindings = new Set();
  for (const entry of packet.findings) {
    if (!entry || typeof entry !== 'object') throw new Error('disposition_packet_entry_invalid');
    const reply = buildReviewDispositionReply({
      repository: packet.repository,
      prNumber: packet.prNumber,
      finding: entry.finding,
      headOid: packet.headOid,
      baseOid: packet.baseOid,
      agentRunId: packet.agentRunId,
      sender: packet.sender,
      webhookEventId: entry.webhookEventId,
      rationale: entry.rationale,
      nextAction: entry.nextAction ?? null,
      evidenceSha256: entry.evidenceSha256,
    });
    if (!Number.isSafeInteger(entry.commentDatabaseId) || entry.commentDatabaseId < 1) {
      throw new Error(`finding ${reply.decision.id}: comment_database_id_invalid`);
    }
    if (seenFindings.has(reply.decision.id)) throw new Error(`finding ${reply.decision.id}: duplicated_in_packet`);
    seenFindings.add(reply.decision.id);
    const pendingFix = reply.decision.disposition === 'FIX_REQUIRED' && !reply.decision.fixedOnHead;
    replies.push({
      findingId: reply.decision.id,
      threadId: reply.decision.threadId,
      commentDatabaseId: entry.commentDatabaseId,
      disposition: reply.decision.disposition,
      severity: reply.decision.severity,
      riskClass: reply.decision.riskClass,
      // ESCALATE keeps the thread open for external authority; a pending FIX_REQUIRED
      // stays open until the repair head, tests, CI and re-review exist.
      resolvable: reply.decision.disposition !== 'ESCALATE' && !pendingFix,
      tupleKey: reply.tupleKey,
      metadata: reply.metadata,
      body: reply.body,
    });
  }
  const byDisposition = {};
  for (const reply of replies) byDisposition[reply.disposition] = (byDisposition[reply.disposition] || 0) + 1;
  return {
    schemaVersion: DISPOSITION_PLAN_SCHEMA,
    status: 'RENDERED',
    repository: packet.repository,
    prNumber: packet.prNumber,
    baseOid: packet.baseOid,
    headOid: packet.headOid,
    agentRunId: packet.agentRunId,
    sender: packet.sender,
    renderedAt: now.toISOString(),
    summary: {
      total: replies.length,
      byDisposition,
      escalated: byDisposition.ESCALATE || 0,
      fixPending: replies.filter((reply) => reply.disposition === 'FIX_REQUIRED' && !reply.resolvable).length,
      // A disposition reply never satisfies the merge gate by itself.
      mergeGateSatisfiedByAssertion: false,
    },
    replies,
  };
}

function runDispose(prNumber, args) {
  const packetIndex = args.indexOf('--packet');
  const packetPath = packetIndex >= 0 ? args[packetIndex + 1] : '';
  if (!packetPath) {
    process.stderr.write('dispose requires --packet <path>.\n');
    return false;
  }
  let packet;
  try {
    packet = JSON.parse(fs.readFileSync(packetPath, 'utf8'));
  } catch (error) {
    process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: disposition_packet_unreadable (${error?.message || error})\n`);
    return false;
  }
  if (packet?.prNumber !== prNumber) {
    process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: packet_pr_mismatch\n`);
    return false;
  }
  let plan;
  try {
    plan = buildReviewDispositionPlan(packet, getPrSnapshot(prNumber));
  } catch (error) {
    process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: ${error?.message || error}\n`);
    return false;
  }
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) {
    fs.writeFileSync(args[outIndex + 1], `${JSON.stringify(plan, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (plan.status !== 'RENDERED') {
    process.stderr.write(`[manage-pr-queue] HELD PR #${prNumber}: ${plan.reason}\n`);
    return false;
  }
  return true;
}

export function installGitHooks() {
  process.stderr.write(
    '[manage-pr-queue] HELD: repository-controlled Git hook installation is disabled; use explicit lifecycle commands.\n',
  );
  return false;
}

export function runHookMaintenance({
  triggerOrphanCleanupImpl = triggerOrphanCleanup,
} = {}) {
  return triggerOrphanCleanupImpl(true);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const prNumber = requirePrNumber(args);
  if (command === 'status') {
    if (!prNumber) {
      process.stderr.write('status requires --pr <number>.\n');
      process.exitCode = 2;
      return;
    }
    printStatus(prNumber, args.includes('--json'));
    return;
  }
  if (command === 'install-hooks') {
    if (!installGitHooks()) process.exitCode = 2;
    return;
  }
  if (command === 'hook') {
    runHookMaintenance();
    return;
  }
  if (!prNumber) {
    process.stderr.write(`${command} requires --pr <number>.\n`);
    process.exitCode = 2;
    return;
  }
  if (command === 'dispose') {
    if (!runDispose(prNumber, args)) process.exitCode = 2;
  } else if (command === 'update-branch') {
    const pr = getPrSnapshot(prNumber);
    if (!pr || !updateBranch(prNumber, pr.headRefName)) process.exitCode = 2;
  } else if (command === 'approve') {
    approvePr(prNumber);
    process.exitCode = 2;
  } else if (command === 'auto-fix') {
    if (!validatePrPreflight(prNumber)) process.exitCode = 2;
  } else if (command === 'merge') {
    const pr = getPrSnapshot(prNumber);
    if (!pr || !mergePr(prNumber, pr.headRefOid)) process.exitCode = 2;
  } else if (command === 'run-queue') {
    if (!await runQueue({ prNumber, auto: args.includes('--auto') })) process.exitCode = 2;
  } else {
    process.stderr.write(`Unknown command: ${command}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    process.stderr.write(`[manage-pr-queue] ${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
