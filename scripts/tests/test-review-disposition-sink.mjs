import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewDispositionPlan } from '../dev/manage-pr-queue.mjs';
import {
  assertNoCredentialOverride,
  planSinkActions,
  validatePlanShape,
} from '../dev/post-review-disposition.mjs';

const SHA = (value) => value.repeat(40);
const DIGEST = (value) => value.repeat(64);
const REPOSITORY = 'monkey1sai/AI-BIM-governance';

const makePacket = (overrides = {}) => ({
  schemaVersion: 'ai-bim-review-disposition-packet/v1',
  repository: REPOSITORY,
  prNumber: 737,
  baseOid: SHA('b'),
  headOid: SHA('a'),
  agentRunId: 'claude-d23c2a-run-1',
  sender: 'monkey1sai',
  findings: [
    {
      commentDatabaseId: 3902413013,
      webhookEventId: 'review_comment:3902413013',
      evidenceSha256: DIGEST('c'),
      rationale: 'Confirmed on the current head: an invalid Date makes every expiry comparison false, so the lease check must fail closed.',
      nextAction: 'Repair on a batch head with a regression, then request an independent re-review.',
      finding: {
        id: 'PRRC_3902413013', threadId: 'PRRT_thread_1', source: 'reviewer', severity: 'P2',
        verification: 'confirmed', inScope: true, riskClass: 'correctness', disposition: 'FIX_REQUIRED',
        fixedOnHead: false, fixEvidence: null, evidence: ['scripts/lib/autonomous-delivery-finalization.mjs:481'],
        policyRule: 'confirmed-p2-in-scope', followUpRef: null, threadResolved: false,
      },
    },
    {
      commentDatabaseId: 3902413022,
      webhookEventId: 'review_comment:3902413022',
      evidenceSha256: DIGEST('d'),
      rationale: 'Refuted: the collector already binds diff bytes to the changed-file surface, see the regression test for the exact case.',
      nextAction: null,
      finding: {
        id: 'PRRC_3902413022', threadId: 'PRRT_thread_2', source: 'reviewer', severity: 'P2',
        verification: 'refuted', inScope: true, riskClass: 'correctness', disposition: 'FALSE_POSITIVE',
        fixedOnHead: false, fixEvidence: null, evidence: ['scripts/tests/test-autonomous-delivery-finalization.mjs:160'],
        policyRule: 'false-positive-evidence', followUpRef: null, threadResolved: false,
      },
    },
    {
      commentDatabaseId: 3902413033,
      webhookEventId: 'review_comment:3902413033',
      evidenceSha256: DIGEST('e'),
      rationale: 'This finding changes the deployment trust boundary and is outside autonomous authority; escalating to the owner.',
      nextAction: null,
      finding: {
        id: 'PRRC_3902413033', threadId: 'PRRT_thread_3', source: 'reviewer', severity: 'P1',
        verification: 'unverified', inScope: true, riskClass: 'deployment', disposition: 'ESCALATE',
        fixedOnHead: false, fixEvidence: null, evidence: ['scripts/lib/linux-continuous-deployment.mjs:689'],
        policyRule: 'high-risk-escalation', followUpRef: null, threadResolved: false,
      },
    },
  ],
  ...overrides,
});

const makeSnapshot = (overrides = {}) => ({
  number: 737, state: 'OPEN', isDraft: false, baseRefName: 'main', baseRefOid: SHA('b'), headRefOid: SHA('a'), ...overrides,
});

const renderPlan = (packetOverrides = {}) => buildReviewDispositionPlan(makePacket(packetOverrides), makeSnapshot(), {
  now: new Date('2026-09-02T04:00:00.000Z'),
});

test('the queue observer renders a bound disposition plan and holds on exact-head drift', () => {
  const plan = renderPlan();
  assert.equal(plan.status, 'RENDERED');
  assert.equal(plan.summary.total, 3);
  assert.deepEqual(plan.summary.byDisposition, { FIX_REQUIRED: 1, FALSE_POSITIVE: 1, ESCALATE: 1 });
  assert.equal(plan.summary.escalated, 1);
  assert.equal(plan.summary.fixPending, 1);
  assert.equal(plan.summary.mergeGateSatisfiedByAssertion, false);
  assert.deepEqual(plan.replies.map((reply) => reply.resolvable), [false, true, false]);
  assert.match(plan.replies[0].body, /<!-- ai-bim-review-disposition\/v1 \{/);
  assert.match(plan.replies[0].body, /"fixed_on_head":false/);
  assert.equal(buildReviewDispositionPlan(makePacket(), makeSnapshot({ headRefOid: SHA('9') })).reason, 'exact_head_drift');
  assert.equal(buildReviewDispositionPlan(makePacket(), makeSnapshot({ state: 'MERGED' })).reason, 'pr_not_open');
  assert.equal(buildReviewDispositionPlan(makePacket(), makeSnapshot({ isDraft: true })).reason, 'pr_is_draft');
  assert.equal(buildReviewDispositionPlan(makePacket({ repository: 'other/repo' }), makeSnapshot()).reason, 'packet_repository_not_supported');
  assert.equal(buildReviewDispositionPlan(makePacket({ prNumber: 738 }), makeSnapshot()).reason, 'packet_pr_mismatch');
  assert.equal(buildReviewDispositionPlan({ schemaVersion: 'other' }, makeSnapshot()).reason, 'disposition_packet_schema_invalid');
  assert.throws(() => buildReviewDispositionPlan(makePacket({
    findings: [makePacket().findings[0], makePacket().findings[0]],
  }), makeSnapshot()), /duplicated_in_packet/);
});

function makeGh({ tuple = makeSnapshot(), threads = {}, identity = { login: 'monkey1sai', id: 26239865, type: 'User' }, postedBody = null, failPostFor = null } = {}) {
  const calls = [];
  const gh = (args, options = {}) => {
    calls.push({ args, input: options.input });
    const joined = args.join(' ');
    if (joined.startsWith('api user')) return JSON.stringify(identity);
    if (joined.startsWith('pr view')) return JSON.stringify(typeof tuple === 'function' ? tuple(calls.length) : tuple);
    if (joined.startsWith('api graphql') && joined.includes('resolveReviewThread')) {
      return JSON.stringify({ data: { resolveReviewThread: { thread: { isResolved: true } } } });
    }
    if (joined.startsWith('api graphql')) {
      const threadId = args[args.indexOf('-F') + 1].replace(/^id=/, '');
      const thread = threads[threadId] ?? { isResolved: false, comments: [] };
      return JSON.stringify({ data: { node: {
        isResolved: thread.isResolved,
        comments: { pageInfo: { hasNextPage: false }, nodes: thread.comments.map((comment) => ({
          databaseId: comment.databaseId, author: { login: comment.author }, body: comment.body,
        })) },
      } } });
    }
    if (joined.startsWith('api -X POST')) {
      if (failPostFor && joined.includes(`/comments/${failPostFor}/replies`)) throw new Error('gh: HTTP 502 upstream unavailable');
      return JSON.stringify({ id: 999, html_url: 'https://github.com/monkey1sai/AI-BIM-governance/pull/737#discussion_r999', body: postedBody ?? options.input, user: { login: 'monkey1sai' } });
    }
    throw new Error(`unexpected gh call: ${joined}`);
  };
  return { gh, calls };
}

const threadsFor = (plan, extra = {}) => Object.fromEntries(plan.replies.map((reply) => [reply.threadId, {
  isResolved: false,
  comments: [{ databaseId: reply.commentDatabaseId, author: 'chatgpt-codex-connector', body: 'finding text' }, ...(extra[reply.threadId] ?? [])],
}]));

test('the sink refuses credential overrides and a foreign owner identity before touching GitHub', () => {
  const plan = renderPlan();
  assert.throws(() => assertNoCredentialOverride({ PATH: 'x', GH_TOKEN: 'set' }), /credential_override_present:GH_TOKEN/);
  const { gh, calls } = makeGh({ identity: { login: 'someone-else', id: 1, type: 'User' } });
  assert.throws(() => planSinkActions({ plan, gh, env: {} }), /owner_identity_mismatch/);
  assert.equal(calls.length, 1);
  assert.throws(() => validatePlanShape({ ...plan, status: 'HELD' }), /plan_not_rendered/);
  assert.throws(() => validatePlanShape({ ...plan, replies: [{ ...plan.replies[0], body: 'stripped' }] }), /reply_metadata_unbound/);
});

test('the plan file cannot assert resolvability, identity, or disposition beyond what the body metadata carries', () => {
  const plan = renderPlan();
  // Hand-editing the ESCALATE reply to resolvable:true must be rejected before any mutation.
  assert.throws(() => validatePlanShape({
    ...plan, replies: plan.replies.map((reply) => (reply.disposition === 'ESCALATE' ? { ...reply, resolvable: true } : reply)),
  }), /reply_resolvable_mismatch:PRRC_3902413033/);
  // A pending FIX_REQUIRED cannot be promoted to resolvable either.
  assert.throws(() => validatePlanShape({
    ...plan, replies: plan.replies.map((reply) => (reply.disposition === 'FIX_REQUIRED' ? { ...reply, resolvable: true } : reply)),
  }), /reply_resolvable_mismatch:PRRC_3902413013/);
  assert.throws(() => validatePlanShape({
    ...plan, replies: plan.replies.map((reply, index) => (index === 0 ? { ...reply, disposition: 'ACCEPTED' } : reply)),
  }), /reply_identity_unbound/);
  assert.throws(() => validatePlanShape({
    ...plan, replies: plan.replies.map((reply, index) => (index === 0 ? { ...reply, threadId: 'PRRT_other' } : reply)),
  }), /reply_identity_unbound/);
  assert.throws(() => validatePlanShape({ ...plan, headOid: SHA('9') }), /reply_head_unbound/);
  // An edited plan cannot publish two decisions for one finding or thread.
  assert.throws(() => validatePlanShape({ ...plan, replies: [...plan.replies, plan.replies[0]] }), /plan_replies_duplicated/);
  const secondPlan = renderPlan({ agentRunId: 'claude-d23c2a-run-2' });
  assert.throws(() => validatePlanShape({ ...plan, replies: [...plan.replies, secondPlan.replies[0]] }), /plan_replies_duplicated/);
});

test('dry run posts nothing, live posts once per finding, and reruns dedupe on the hidden metadata', () => {
  const plan = renderPlan();
  const dry = makeGh({ threads: threadsFor(plan) });
  const dryResult = planSinkActions({ plan, gh: dry.gh, env: {} });
  assert.deepEqual(dryResult.results.map((entry) => entry.action), ['dry_run_post', 'dry_run_post', 'dry_run_post']);
  assert.equal(dry.calls.some((call) => call.args.includes('POST')), false);

  const live = makeGh({ threads: threadsFor(plan) });
  const liveResult = planSinkActions({ plan, gh: live.gh, live: true, resolve: true, env: {} });
  assert.deepEqual(liveResult.results.map((entry) => entry.action), ['posted', 'posted', 'posted']);
  // Only the FALSE_POSITIVE thread is resolvable: FIX_REQUIRED waits for the repair, ESCALATE stays open.
  assert.deepEqual(liveResult.results.map((entry) => entry.resolved), [false, true, false]);
  const posts = live.calls.filter((call) => call.args.includes('POST'));
  assert.equal(posts.length, 3);
  assert.match(posts[0].input, /<!-- ai-bim-review-disposition\/v1/);
  assert.doesNotMatch(posts[0].input, /@codex|@claude/i);

  const rerun = makeGh({ threads: threadsFor(plan, Object.fromEntries(plan.replies.map((reply) => [reply.threadId, [
    { databaseId: 500, author: 'monkey1sai', body: reply.body },
  ]]))) });
  const rerunResult = planSinkActions({ plan, gh: rerun.gh, live: true, env: {} });
  assert.deepEqual(rerunResult.results.map((entry) => entry.reason), ['duplicate_exact_tuple', 'duplicate_exact_tuple', 'duplicate_exact_tuple']);
  assert.equal(rerun.calls.some((call) => call.args.includes('POST')), false);
  assert.deepEqual(rerunResult.results.map((entry) => entry.resolved), [false, false, false]);
  // A rerun with --resolve finishes the resolution a crashed run left pending, and only for the resolvable duplicate.
  const finish = makeGh({ threads: threadsFor(plan, Object.fromEntries(plan.replies.map((reply) => [reply.threadId, [
    { databaseId: 500, author: 'monkey1sai', body: reply.body },
  ]]))) });
  const finishResult = planSinkActions({ plan, gh: finish.gh, live: true, resolve: true, env: {} });
  assert.deepEqual(finishResult.results.map((entry) => [entry.action, entry.reason, entry.resolved]), [
    ['skip', 'duplicate_exact_tuple', false], ['skip', 'duplicate_exact_tuple', true], ['skip', 'duplicate_exact_tuple', false],
  ]);
  assert.equal(finish.calls.some((call) => call.args.includes('POST')), false);
  assert.equal(finish.calls.filter((call) => call.args.join(' ').includes('resolveReviewThread')).length, 1);
});

test('a head that moves right after a reply is posted is recorded as drift and never resolved', () => {
  const plan = renderPlan({ findings: [makePacket().findings[1]] });
  let reads = 0;
  const { gh, calls } = makeGh({
    threads: threadsFor(plan),
    // 1st read: before post, 2nd: immediately after post -> drift.
    tuple: () => { reads += 1; return makeSnapshot(reads >= 2 ? { headRefOid: SHA('9') } : {}); },
  });
  const result = planSinkActions({ plan, gh, live: true, resolve: true, env: {} });
  assert.equal(result.results[0].action, 'posted');
  assert.equal(result.results[0].reason, 'posted_head_drift');
  assert.equal(result.results[0].resolved, false);
  assert.equal(calls.some((call) => call.args.join(' ').includes('resolveReviewThread')), false);
  // Without --resolve the post-mutation re-read still happens.
  reads = 0;
  const plain = planSinkActions({ plan, gh, live: true, env: {} });
  assert.equal(plain.results[0].reason, 'posted_head_drift');
});

test('the sink holds on head drift, resolved threads, missing finding comments, sender mismatch, and readback mismatch', () => {
  const plan = renderPlan();
  const drift = makeGh({ tuple: makeSnapshot({ headRefOid: SHA('9') }), threads: threadsFor(plan) });
  assert.deepEqual(planSinkActions({ plan, gh: drift.gh, live: true, env: {} }).results.map((entry) => entry.reason), [
    'exact_head_drift', 'exact_head_drift', 'exact_head_drift',
  ]);
  const resolved = makeGh({ threads: Object.fromEntries(Object.entries(threadsFor(plan)).map(([id, thread]) => [id, { ...thread, isResolved: true }])) });
  assert.equal(planSinkActions({ plan, gh: resolved.gh, live: true, env: {} }).results[0].reason, 'thread_already_resolved');
  const missing = makeGh({ threads: Object.fromEntries(plan.replies.map((reply) => [reply.threadId, { isResolved: false, comments: [] }])) });
  assert.equal(planSinkActions({ plan, gh: missing.gh, live: true, env: {} }).results[0].reason, 'finding_comment_not_in_thread');
  const tampered = makeGh({ threads: threadsFor(plan), postedBody: 'server returned a different body' });
  const tamperedResult = planSinkActions({ plan, gh: tampered.gh, live: true, env: {} });
  assert.equal(tamperedResult.results[0].action, 'hold');
  assert.equal(tamperedResult.results[0].reason, 'readback_mismatch');
  // A reply whose metadata names a different sender than the authenticated identity never posts.
  const foreign = renderPlan({ sender: 'monkey1sai-blip' });
  const foreignGh = makeGh({ threads: threadsFor(foreign) });
  const foreignResult = planSinkActions({ plan: foreign, gh: foreignGh.gh, live: true, env: {} });
  assert.deepEqual(foreignResult.results.map((entry) => entry.reason), ['sender_identity_mismatch', 'sender_identity_mismatch', 'sender_identity_mismatch']);
  assert.equal(foreignGh.calls.some((call) => call.args.includes('POST')), false);
});

test('a failure on one reply is recorded without discarding earlier results', () => {
  const plan = renderPlan();
  const flaky = makeGh({ threads: threadsFor(plan), failPostFor: plan.replies[1].commentDatabaseId });
  const result = planSinkActions({ plan, gh: flaky.gh, live: true, env: {} });
  assert.deepEqual(result.results.map((entry) => entry.action), ['posted', 'error', 'posted']);
  assert.match(result.results[1].reason, /^error:gh: HTTP 502/);
});

test('a head that moves between posting and resolving is recorded as a resolution race', () => {
  const plan = renderPlan({ findings: [makePacket().findings[1]] });
  let reads = 0;
  const { gh } = makeGh({
    threads: threadsFor(plan),
    tuple: () => {
      reads += 1;
      // 1st read: before post, 2nd: after post, 3rd: before resolve, 4th: after resolve -> drift.
      return makeSnapshot(reads >= 4 ? { headRefOid: SHA('9') } : {});
    },
  });
  const result = planSinkActions({ plan, gh, live: true, resolve: true, env: {} });
  assert.equal(result.results[0].action, 'posted');
  assert.equal(result.results[0].resolved, true);
  assert.equal(result.results[0].reason, 'resolution_race');
});
