#!/usr/bin/env node
// Coordinator-owned reply sink for Review Disposition plans rendered by
// `manage-pr-queue.mjs dispose`. Kept outside the read-only queue observer by
// design: the observer renders, this sink posts. Every mutation re-reads the exact
// PR tuple immediately before acting, dedupes on the hidden metadata tuple parsed
// from the body itself (never a sidecar), derives resolvability from that same
// metadata, never resolves an escalated or unrepaired finding, and never approves
// or merges.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  parseReviewDispositionMetadata,
  planReviewDispositionMutation,
  reviewDispositionResolvable,
  reviewDispositionTupleKey,
} from '../lib/autonomous-delivery-finalization.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const GH_EXECUTABLE = process.platform === 'win32' ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh';
const GITHUB_REPOSITORY = 'monkey1sai/AI-BIM-governance';
// The only identity allowed to post coordinator replies. A different login, id or
// type means an unexpected credential is present and the sink must not act.
export const OWNER_IDENTITY = Object.freeze({ login: 'monkey1sai', id: 26239865, type: 'User' });
const CREDENTIAL_OVERRIDE_ENV = /^(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GH_HOST|GH_CONFIG_DIR|XDG_CONFIG_HOME)$/i;
const PLAN_SCHEMA = 'ai-bim-review-disposition-plan/v1';
const THREAD_QUERY = [
  'query($id:ID!){node(id:$id){... on PullRequestReviewThread {isResolved ',
  'comments(first:100){pageInfo{hasNextPage} nodes{databaseId author{login} body}}}}}',
].join('');
const RESOLVE_MUTATION = 'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}';
// A mutation that landed on a moved head, or a resolution that never landed, is a
// failed run even though the reply itself was posted.
const FAILED_REASONS = new Set(['posted_head_drift', 'resolution_skipped_head_drift', 'resolution_race']);
const LOCK_STALE_MS = 30 * 60 * 1000;

export function sinkResultFailed(entry, { resolve = false } = {}) {
  if (entry.action === 'hold' || entry.action === 'error') return true;
  if (typeof entry.reason === 'string' && (FAILED_REASONS.has(entry.reason) || entry.reason.startsWith('error:'))) return true;
  return resolve === true && entry.resolvable === true && entry.action === 'posted' && entry.resolved !== true;
}

// The dedupe read and the POST are not atomic on GitHub's side, so the sink
// serializes itself per PR with a coordinator-local lock. A held lock is a
// fail-closed hold, never a retry; a lock older than the stale window belonged to
// a dead run and is reclaimed exactly once.
// A lock names its holder (pid + random token). It is reclaimed only when the
// holder process is provably gone AND the file is older than the stale window;
// a long-running live sink keeps its lock. Release deletes the file only while
// it still carries the releaser's own token, so a reclaimed lock is never
// deleted from under its new holder.
const processAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
};
const readLockOwner = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
export function createPlanLock({
  root = path.join(os.tmpdir(), 'ai-bim-review-disposition-locks'), now = () => Date.now(), isAlive = processAlive,
} = {}) {
  return {
    acquire({ repository, prNumber }) {
      fs.mkdirSync(root, { recursive: true });
      const file = path.join(root, `${String(repository).replace(/[^A-Za-z0-9_.-]/gu, '__')}-${prNumber}.lock`);
      const token = crypto.randomBytes(16).toString('hex');
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const fd = fs.openSync(file, 'wx');
          fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, acquiredAt: new Date(now()).toISOString() }));
          fs.closeSync(fd);
          return {
            release: () => {
              const owner = readLockOwner(file);
              if (owner?.token !== token) return;
              try { fs.unlinkSync(file); } catch { /* already released */ }
            },
          };
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          const owner = readLockOwner(file);
          let stale = false;
          try { stale = now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS; } catch { stale = false; }
          const holderDead = owner === null || !isAlive(owner.pid);
          if (!stale || !holderDead || attempt > 0) throw new Error(`sink_lock_held:${file}`);
          try { fs.unlinkSync(file); } catch { /* raced with the owner */ }
        }
      }
      throw new Error(`sink_lock_held:${file}`);
    },
  };
}

export function assertNoCredentialOverride(env = process.env) {
  for (const key of Object.keys(env || {})) {
    if (CREDENTIAL_OVERRIDE_ENV.test(key)) throw new Error(`credential_override_present:${key}`);
  }
}

export function createGhRunner({ execFileSyncImpl = execFileSync, env = process.env } = {}) {
  return (args, { input } = {}) => execFileSyncImpl(GH_EXECUTABLE, args, {
    encoding: 'utf8',
    env,
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

export function readOwnerIdentity(gh) {
  const identity = JSON.parse(gh(['api', 'user', '--jq', '{login,id,type}']));
  if (identity.login !== OWNER_IDENTITY.login || identity.id !== OWNER_IDENTITY.id || identity.type !== OWNER_IDENTITY.type) {
    throw new Error('owner_identity_mismatch');
  }
  return identity;
}

export function readPrTuple(gh, prNumber) {
  return JSON.parse(gh([
    'pr', 'view', String(prNumber), '--repo', GITHUB_REPOSITORY,
    '--json', 'number,state,isDraft,baseRefName,baseRefOid,headRefOid',
  ]));
}

export function readThreadComments(gh, threadId) {
  const node = JSON.parse(gh(['api', 'graphql', '-f', `query=${THREAD_QUERY}`, '-F', `id=${threadId}`]))?.data?.node;
  if (!node || typeof node.isResolved !== 'boolean' || !Array.isArray(node.comments?.nodes)) {
    throw new Error(`thread_unreadable:${threadId}`);
  }
  if (node.comments.pageInfo?.hasNextPage) throw new Error(`thread_pagination_incomplete:${threadId}`);
  return {
    isResolved: node.isResolved,
    comments: node.comments.nodes.map((comment) => ({
      databaseId: comment.databaseId,
      author: comment.author?.login ?? null,
      body: String(comment.body ?? ''),
    })),
  };
}

const tupleMatches = (tuple, plan) => (
  tuple?.state === 'OPEN' && tuple.isDraft === false && tuple.baseRefName === 'main' &&
  tuple.number === plan.prNumber && tuple.headRefOid === plan.headOid && tuple.baseRefOid === plan.baseOid
);

// Binds every reply to the metadata carried in its own body. The plan file is an
// on-disk artifact anyone could edit, so nothing in it is trusted beyond the body.
export function validatePlanShape(plan) {
  if (!plan || typeof plan !== 'object' || plan.schemaVersion !== PLAN_SCHEMA) throw new Error('plan_schema_invalid');
  if (plan.status !== 'RENDERED') throw new Error(`plan_not_rendered:${plan.status ?? 'unknown'}`);
  if (plan.repository !== GITHUB_REPOSITORY) throw new Error('plan_repository_not_supported');
  if (!Array.isArray(plan.replies) || plan.replies.length === 0) throw new Error('plan_replies_missing');
  if (plan.replies.length > 256) throw new Error('plan_replies_unbounded');
  // Re-impose the observer's uniqueness rule at this untrusted file boundary so an
  // edited plan cannot publish two contradictory decisions for one finding.
  const findingIds = new Set(plan.replies.map((reply) => reply?.findingId));
  const threadIds = new Set(plan.replies.map((reply) => reply?.threadId));
  if (findingIds.size !== plan.replies.length || threadIds.size !== plan.replies.length) throw new Error('plan_replies_duplicated');
  const bound = plan.replies.map((reply) => {
    const metadata = parseReviewDispositionMetadata(reply.body);
    if (!metadata || reviewDispositionTupleKey(metadata) !== reply.tupleKey) throw new Error(`reply_metadata_unbound:${reply.findingId}`);
    if (
      metadata.repository !== plan.repository || metadata.pr_number !== plan.prNumber ||
      metadata.head_sha !== plan.headOid || metadata.base_sha !== plan.baseOid
    ) throw new Error(`reply_head_unbound:${reply.findingId}`);
    if (metadata.finding_id !== reply.findingId || metadata.thread_id !== reply.threadId || metadata.disposition !== reply.disposition) {
      throw new Error(`reply_identity_unbound:${reply.findingId}`);
    }
    if (!Number.isSafeInteger(reply.commentDatabaseId) || reply.commentDatabaseId < 1) throw new Error(`reply_comment_invalid:${reply.findingId}`);
    if (reply.resolvable !== reviewDispositionResolvable(metadata)) throw new Error(`reply_resolvable_mismatch:${reply.findingId}`);
    return { ...reply, resolvable: reviewDispositionResolvable(metadata), bodyMetadata: metadata };
  });
  return { ...plan, replies: bound };
}

const errorReason = (error) => `error:${String(error?.message || error).replace(/\s+/gu, ' ').slice(0, 200)}`;

// Executes one plan. `gh` is injected so the decision logic is testable without a
// network; `live` posts replies, `resolve` additionally resolves resolvable threads.
// A failure on one reply is recorded and never discards the results of earlier ones.
export function planSinkActions({
  plan: planRaw, gh, live = false, resolve = false, env = process.env, now = () => new Date(), lock = createPlanLock(),
} = {}) {
  assertNoCredentialOverride(env);
  const plan = validatePlanShape(planRaw);
  const identity = readOwnerIdentity(gh);
  const results = [];
  const held = lock.acquire({ repository: plan.repository, prNumber: plan.prNumber });
  try {
  for (const reply of plan.replies) {
    const record = {
      findingId: reply.findingId,
      threadId: reply.threadId,
      disposition: reply.disposition,
      resolvable: reply.resolvable,
      tupleKey: reply.tupleKey,
      action: null,
      reason: null,
      commentId: null,
      commentUrl: null,
      resolved: false,
      observedAt: now().toISOString(),
    };
    results.push(record);
    try {
      if (reply.bodyMetadata.sender !== identity.login) {
        Object.assign(record, { action: 'hold', reason: 'sender_identity_mismatch' });
        continue;
      }
      const tuple = readPrTuple(gh, plan.prNumber);
      if (!tupleMatches(tuple, plan)) {
        Object.assign(record, { action: 'hold', reason: 'exact_head_drift' });
        continue;
      }
      const thread = readThreadComments(gh, reply.threadId);
      if (thread.isResolved) {
        Object.assign(record, { action: 'hold', reason: 'thread_already_resolved' });
        continue;
      }
      if (!thread.comments.some((comment) => comment.databaseId === reply.commentDatabaseId)) {
        Object.assign(record, { action: 'hold', reason: 'finding_comment_not_in_thread' });
        continue;
      }
      const decision = planReviewDispositionMutation({ existingComments: thread.comments, candidateMetadata: reply.bodyMetadata });
      // Bounded single-thread resolution: re-read the head before and after, and
      // record a race instead of assuming the resolution still binds the same head.
      const resolveThread = () => {
        if (!tupleMatches(readPrTuple(gh, plan.prNumber), plan)) {
          record.reason = 'resolution_skipped_head_drift';
          return;
        }
        const mutation = JSON.parse(gh(['api', 'graphql', '-f', `query=${RESOLVE_MUTATION}`, '-F', `id=${reply.threadId}`]));
        record.resolved = mutation?.data?.resolveReviewThread?.thread?.isResolved === true;
        if (!tupleMatches(readPrTuple(gh, plan.prNumber), plan)) record.reason = 'resolution_race';
      };
      if (decision.action !== 'post') {
        Object.assign(record, { action: decision.action, reason: decision.reason });
        // An exact duplicate whose resolution never landed (a crash between the
        // POST and the GraphQL mutation) is finished here instead of skipped forever.
        // Both safe skip reasons mean "this decision already stands on this head": an
        // exact duplicate, or the same decision from a different run. Either may
        // have crashed before its resolution landed.
        if (live && resolve && decision.action === 'skip' && ['duplicate_exact_tuple', 'already_dispositioned_on_head'].includes(decision.reason) && reply.resolvable) {
          resolveThread();
        }
        continue;
      }
      if (!live) {
        Object.assign(record, { action: 'dry_run_post', reason: decision.reason });
        continue;
      }
      const posted = JSON.parse(gh([
        'api', '-X', 'POST',
        `repos/${GITHUB_REPOSITORY}/pulls/${plan.prNumber}/comments/${reply.commentDatabaseId}/replies`,
        '-F', 'body=@-',
      ], { input: reply.body }));
      const readback = parseReviewDispositionMetadata(String(posted?.body ?? ''));
      if (!readback || reviewDispositionTupleKey(readback) !== reply.tupleKey || posted?.user?.login !== identity.login) {
        Object.assign(record, { action: 'hold', reason: 'readback_mismatch', commentId: posted?.id ?? null });
        continue;
      }
      Object.assign(record, { action: 'posted', reason: decision.reason, commentId: posted.id, commentUrl: posted.html_url });
      // The tuple is re-read right after every mutation, not only before a
      // resolution: a reply that landed on a moved head is recorded as raced and
      // is never followed by a resolution.
      if (!tupleMatches(readPrTuple(gh, plan.prNumber), plan)) {
        record.reason = 'posted_head_drift';
        continue;
      }
      if (!resolve || !reply.resolvable) continue;
      resolveThread();
    } catch (error) {
      Object.assign(record, { action: record.action === 'posted' ? 'posted' : 'error', reason: errorReason(error) });
    }
  }
  } finally {
    held.release();
  }
  return {
    schemaVersion: 'ai-bim-review-disposition-sink-result/v1',
    repository: plan.repository,
    prNumber: plan.prNumber,
    headOid: plan.headOid,
    baseOid: plan.baseOid,
    live,
    resolve,
    sender: identity.login,
    ok: !results.some((entry) => sinkResultFailed(entry, { resolve })),
    results,
  };
}

function readArg(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

async function main() {
  const args = process.argv.slice(2);
  const planPath = readArg(args, '--plan');
  if (!planPath) {
    process.stderr.write('usage: node scripts/dev/post-review-disposition.mjs --plan <plan.json> [--live] [--resolve] [--out <result.json>]\n');
    process.exitCode = 2;
    return;
  }
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const result = planSinkActions({
    plan,
    gh: createGhRunner(),
    live: args.includes('--live'),
    resolve: args.includes('--resolve'),
  });
  const outPath = readArg(args, '--out');
  if (outPath) fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok !== true) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    process.stderr.write(`[post-review-disposition] ${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
