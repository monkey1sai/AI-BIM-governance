import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLifecycleMaintenance } from '../dev/agents-board.mjs';
import {
  approvePr,
  classifyQueueCommand,
  evaluateMergeReadiness,
  isSamePrObservation,
  installGitHooks,
  mergePr,
  runCommand,
  runHookMaintenance,
  updateBranch,
} from '../dev/manage-pr-queue.mjs';

function makeTempRepo(t, prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  return repo;
}

test('merge readiness fails closed on every exact-head gate', () => {
  const pr = {
    state: 'OPEN',
    baseRefName: 'main',
    isDraft: false,
    headRefOid: 'a'.repeat(40),
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
  };
  const checks = { allGreen: true };
  const threads = { count: 0, complete: true };
  const approval = { count: 1, complete: true };
  assert.deepEqual(
    evaluateMergeReadiness({ pr, checks, threads, approval, expectedHeadSha: pr.headRefOid }),
    {
      ready: false,
      observedReady: true,
      reasons: ['canonical_merge_authority_external'],
    },
  );

  const cases = [
    [{ ...pr, baseRefName: 'release' }, checks, threads, 'base_not_main'],
    [{ ...pr, isDraft: true }, checks, threads, 'draft'],
    [{ ...pr, headRefOid: 'b'.repeat(40) }, checks, threads, 'head_mismatch'],
    [{ ...pr, mergeable: 'UNKNOWN' }, checks, threads, 'not_mergeable'],
    [{ ...pr, mergeStateStatus: 'BEHIND' }, checks, threads, 'behind_main'],
    [{ ...pr, mergeStateStatus: 'UNSTABLE' }, checks, threads, 'merge_state_not_clean'],
    [{ ...pr, reviewDecision: 'REVIEW_REQUIRED' }, checks, threads, 'approval_missing'],
    [pr, { allGreen: false }, threads, 'required_checks_not_green'],
    [pr, checks, { count: null, complete: false }, 'thread_state_unknown'],
    [pr, checks, { count: 1, complete: true }, 'unresolved_threads'],
  ];
  for (const [candidate, candidateChecks, candidateThreads, reason] of cases) {
    const result = evaluateMergeReadiness({
      pr: candidate,
      checks: candidateChecks,
      threads: candidateThreads,
      approval,
      expectedHeadSha: pr.headRefOid,
    });
    assert.equal(result.ready, false);
    assert.equal(result.observedReady, false);
    assert.ok(result.reasons.includes(reason), reason);
    assert.ok(result.reasons.includes('canonical_merge_authority_external'));
  }
  assert.deepEqual(
    evaluateMergeReadiness({
      pr,
      checks,
      threads,
      approval: { count: 0, complete: true },
      expectedHeadSha: pr.headRefOid,
    }),
    {
      ready: false,
      observedReady: false,
      reasons: ['exact_head_approval_missing', 'canonical_merge_authority_external'],
    },
  );
  assert.deepEqual(
    evaluateMergeReadiness({
      pr,
      checks,
      threads,
      approval: { count: null, complete: false },
      expectedHeadSha: pr.headRefOid,
    }),
    {
      ready: false,
      observedReady: false,
      reasons: ['exact_head_approval_unknown', 'canonical_merge_authority_external'],
    },
  );
});

test('queue observation requires one stable exact PR tuple', () => {
  const initial = {
    number: 721,
    title: 'fixture',
    headRefName: 'feature/fixture',
    headRefOid: 'a'.repeat(40),
    baseRefName: 'main',
    baseRefOid: 'b'.repeat(40),
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    isDraft: false,
    state: 'OPEN',
    url: 'https://github.com/monkey1sai/AI-BIM-governance/pull/721',
  };
  assert.equal(isSamePrObservation(initial, { ...initial }), true);
  for (const field of [
    'headRefOid',
    'baseRefOid',
    'mergeStateStatus',
    'reviewDecision',
    'state',
  ]) {
    assert.equal(isSamePrObservation(initial, {
      ...initial,
      [field]: field.endsWith('Oid') ? 'c'.repeat(40) : 'CHANGED',
    }), false, field);
  }
  assert.equal(isSamePrObservation(initial, null), false);
});

test('counted approval is intentionally external to the queue worker', () => {
  assert.equal(approvePr(999), false);
  assert.equal(updateBranch(999, 'fixture'), false);
  assert.equal(mergePr(999, 'a'.repeat(40)), false);
});

test('session board lifecycle maintenance invokes only the injected cleanup sink', () => {
  const calls = [];
  const result = runLifecycleMaintenance({
    triggerOrphanCleanupImpl: (nonBlocking) => {
      calls.push(nonBlocking);
      return 'cleanup-only';
    },
  });
  assert.equal(result, 'cleanup-only');
  assert.deepEqual(calls, [true]);
});

test('the legacy git hook entrypoint invokes only cleanup and needs no PR tuple', () => {
  const calls = [];
  const result = runHookMaintenance({
    triggerOrphanCleanupImpl: (nonBlocking) => {
      calls.push(nonBlocking);
      return true;
    },
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [true]);
});

test('autonomous queue skill teaches source-pinned bounded finalization without human approval fallback', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const skill = fs.readFileSync(
    path.join(repoRoot, '.claude', 'skills', 'autonomous-pr-queue', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /^description: Use when/m);
  assert.match(skill, /Draft-first/);
  assert.match(skill, /single-writer head freeze/i);
  assert.match(skill, /at most two.*round/i);
  assert.match(skill, /must not start a third head/i);
  assert.match(skill, /complete.*pagination/i);
  assert.match(skill, /critical_machine_adjudication/);
  assert.match(skill, /ACCEPTED.*FIX_REQUIRED.*FALSE_POSITIVE.*DEFERRED.*ESCALATE/s);
  assert.match(skill, /Review Disposition Agent/);
  assert.match(skill, /manage-pr-queue\.mjs dispose --pr/);
  assert.match(skill, /post-review-disposition\.mjs/);
  assert.match(skill, /hidden.*metadata/i);
  assert.match(skill, /finding_id.*head_sha.*agent_run_id.*sender.*webhook_event_id/s);
  assert.match(skill, /never satisfies the merge gate by itself/i);
  assert.match(skill, /actual `success`/);
  assert.match(skill, /`neutral`.*`skipped`.*not.*pass/s);
  assert.match(skill, /single-use lease/i);
  assert.match(skill, /convergence.*machine gate/i);
  assert.doesNotMatch(skill, /human_critical/);
  assert.doesNotMatch(skill, /counted approval/i);
  assert.doesNotMatch(skill, /REQUIRED SUB-SKILL.*blip-approve/i);
});

test('legacy pr-queue-manager skill delegates to the hardened named-PR skill', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const skill = fs.readFileSync(
    path.join(repoRoot, '.claude', 'skills', 'pr-queue-manager', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /^description: Use when/m);
  assert.match(skill, /REQUIRED SUB-SKILL:\*\* Use autonomous-pr-queue/);
  assert.match(skill, /must not become a second controller/i);
  assert.match(skill, /LEGACY_GUARDED/);
  assert.doesNotMatch(skill, /manage-pr-queue\.mjs run-queue --auto/);
  assert.doesNotMatch(skill, /manage-pr-queue\.mjs approve --pr/);
});

test('blip approval skill is explicitly legacy guarded outside autonomous activation', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const skill = fs.readFileSync(
    path.join(repoRoot, '.claude', 'skills', 'blip-approve', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /LEGACY_GUARDED/);
  assert.match(skill, /CANARY_ACTIVE.*AUTONOMOUS_ACTIVE/s);
  assert.match(skill, /must not.*routine.*prerequisite/i);
});

test('skill pressure baseline preserves the observed legacy failures without rewriting passes', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const baseline = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'scripts', 'tests', 'fixtures', 'autonomous-pr-queue-pressure-scenarios.json'),
    'utf8',
  ));
  assert.equal(baseline.schemaVersion, 'autonomous-pr-queue-pressure-baseline/v1');
  assert.match(baseline.baselineCommit, /^[0-9a-f]{40}$/);
  const outcomes = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario.baselineOutcome]));
  assert.equal(outcomes.get('legacy-human-approval-route'), 'violation');
  assert.equal(outcomes.get('round-two-residual-blocker'), 'violation');
  assert.equal(outcomes.get('source-pinned-check-conclusion'), 'passed');
  assert.equal(outcomes.get('complete-server-pagination'), 'passed');
  assert.equal(outcomes.get('credential-separation'), 'passed');
  assert.equal(outcomes.get('stale-head-reuse'), 'passed');
});

test('repository-controlled hook installation is fail-closed and writes nothing', (t) => {
  const repo = makeTempRepo(t, 'queue-hook-');
  const hooksDir = path.join(repo, '.git', 'hooks');
  const custom = '#!/usr/bin/env sh\necho custom\n';
  fs.writeFileSync(path.join(hooksDir, 'post-commit'), custom, 'utf8');
  assert.equal(installGitHooks({ repoRoot: repo }), false);
  assert.equal(fs.readFileSync(path.join(hooksDir, 'post-commit'), 'utf8'), custom);
  for (const hook of ['post-merge', 'post-checkout']) {
    assert.equal(fs.existsSync(path.join(hooksDir, hook)), false);
  }

  const wrapper = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'dev',
    'install-git-hooks.ps1',
  );
  let failure;
  try {
    execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', wrapper], {
      cwd: repo,
      stdio: 'pipe',
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.status, 2);
});

test('queue executor denies mutation and trust-bypass commands before spawning', () => {
  const denied = [
    ['gh', ['pr', 'merge', '721', '--repo', 'monkey1sai/AI-BIM-governance']],
    ['gh', ['pr', 'review', '721', '--approve', '--repo', 'monkey1sai/AI-BIM-governance']],
    ['gh', ['pr', 'update-branch', '721', '--repo', 'monkey1sai/AI-BIM-governance']],
    ['gh', ['api', 'graphql', '-f', 'query=mutation{deleteProjectV2(input:{}){clientMutationId}}', '-F', 'owner=monkey1sai', '-F', 'name=AI-BIM-governance', '-F', 'number=721']],
    ['git', ['fetch', 'origin', '--prune']],
    ['git', ['-c', 'safe.directory=C:/fixture', 'rev-parse', 'HEAD']],
    ['pwsh', ['-File', 'scripts/dev/check-pr-local-preflight.ps1']],
  ];
  for (const [command, args] of denied) {
    let spawned = false;
    const result = runCommand(command, args, process.cwd(), {
      silent: true,
      execFileSyncImpl: () => {
        spawned = true;
        return '';
      },
    });
    assert.equal(result.ok, false, `${command} ${args.join(' ')}`);
    assert.equal(result.exitCode, 2);
    assert.equal(spawned, false);
  }
});

test('queue executor permits only exact observation tuples', () => {
  const viewArgs = [
    'pr', 'view', '721', '--json',
    'number,title,headRefName,headRefOid,baseRefName,baseRefOid,mergeable,mergeStateStatus,reviewDecision,isDraft,state,url',
    '--repo', 'github.com/monkey1sai/AI-BIM-governance',
  ];
  assert.deepEqual(classifyQueueCommand('gh', viewArgs), {
    allowed: true,
    reason: 'allowlisted_pr_view',
  });
  const threadQuery = [
    'query($owner:String!,$name:String!,$number:Int!){',
    'repository(owner:$owner,name:$name){pullRequest(number:$number){',
    'reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}',
    '}}}',
  ].join('');
  assert.deepEqual(classifyQueueCommand('gh', [
    'api', 'graphql', '-f', `query=${threadQuery}`,
    '-F', 'owner=monkey1sai',
    '-F', 'name=AI-BIM-governance',
    '-F', 'number=721',
    '--hostname', 'github.com',
  ]), {
    allowed: true,
    reason: 'allowlisted_graphql_query',
  });
  let invocation;
  const result = runCommand('git', ['rev-parse', 'HEAD'], process.cwd(), {
    silent: true,
    env: {
      Path: 'fixture',
      GIT_DIR: 'C:\\untrusted\\.git',
      git_work_tree: 'C:\\untrusted',
    },
    execFileSyncImpl: (...args) => {
      invocation = args;
      return `${'a'.repeat(40)}\n`;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, 'a'.repeat(40));
  assert.deepEqual(invocation[1], ['rev-parse', 'HEAD']);
  assert.deepEqual(invocation[2].env, { Path: 'fixture' });

  const githubResult = runCommand('gh', viewArgs, process.cwd(), {
    silent: true,
    env: {
      Path: 'fixture',
      GH_TOKEN: 'fixture-token',
      GH_HOST: 'attacker.invalid',
      gh_repo: 'attacker.invalid/owner/repo',
      GH_CONFIG_DIR: 'C:\\untrusted\\gh',
      XDG_CONFIG_HOME: 'C:\\untrusted\\xdg',
    },
    execFileSyncImpl: (...args) => {
      invocation = args;
      return '{}\n';
    },
  });
  assert.equal(githubResult.ok, true);
  assert.deepEqual(invocation[1], viewArgs);
  assert.equal(invocation[2].env.Path, 'fixture');
  assert.equal(invocation[2].env.GH_TOKEN, 'fixture-token');
  assert.deepEqual(
    Object.keys(invocation[2].env).filter((key) => (
      /^(?:GH_HOST|GH_REPO|GH_CONFIG_DIR|XDG_CONFIG_HOME)$/i.test(key)
    )),
    [],
  );
});
