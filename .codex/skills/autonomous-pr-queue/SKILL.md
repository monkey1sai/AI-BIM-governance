---
name: autonomous-pr-queue
description: Use when one repository change is ready to become a named PR and must pass exact-head review, checks, approval, and merge gates without touching unrelated PRs.
argument-hint: "<prNumber>（必要）"
---

# Named PR delivery queue

## Core rule

Operate on one explicit PR. The repository helper is an exact-command observer: it may inspect a named PR, but it never runs arbitrary preflight scripts, updates, approves, or merges. Local preflight, counted approval, and native merge remain independent coordinator actions governed by `docs/agents/github-workflow.md`.

## Delivery sequence

1. Work in the authorized branch/worktree; run affected tests and GitNexus gates.
2. Commit, push, and open one PR with truthful evidence.
3. Run the exact-head local preflight from that PR's checkout.
4. Inspect only the named PR:

```powershell
node scripts/dev/manage-pr-queue.mjs status --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs run-queue --pr <prNumber>
```

The coordinator runs the canonical local-preflight command directly from the exact PR checkout; the repository helper does not delegate to branch-controlled scripts.

5. The following compatibility commands always return `HELD` and perform no GitHub mutation:

```powershell
node scripts/dev/manage-pr-queue.mjs auto-fix --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs update-branch --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs approve --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs merge --pr <prNumber>
```

An authorized coordinator must perform any branch update outside this helper with exact-head compare-and-swap semantics, then re-read the new head and rerun every exact-head gate. Semantic conflicts remain `HELD`.

6. Obtain independent current-head review and governed counted approval. Use the repository's required `blip-approve` workflow only when its exact authority contract is satisfied. `human_critical` requires current-user full-authority language; never infer it from a generic ship request.
7. The coordinator may perform a native merge outside the repository helper only after the canonical contract independently confirms OPEN, base=`main`, non-draft, mergeable, up-to-date, source-bound required checks, zero unresolved threads, the fixed reviewer identity and exact-head approval body, exactly one review mode, and any required `human_critical` override.

After merge, fetch a fresh `origin/main` and verify the merge commit and clean-main invariant.

## Bounded polling

Run one named-PR observation at a time. If the PR still needs CI, review, authority, or approval, let the caller or product wait mechanism wake and invoke another pass; this repository does not start a persistent watcher process:

```powershell
node scripts/dev/manage-pr-queue.mjs run-queue --pr <prNumber>
```

`--auto` is compatibility-only and still performs no GitHub mutation.

## Local hooks and lock

Repository-controlled hook installation is disabled. Explicit board lifecycle commands may launch owned-process cleanup; inspect the actually installed hooks separately because candidate branch code does not change clean-main hook behavior before merge.

Queue serialization uses the shared Git ref `refs/ai-bim/pr-queue-lock`. Each generation is an immutable blob containing PID, process creation identity, owner token, and timestamp. Git `update-ref` compare-and-swap creates, releases, and reclaims the exact object ID, so crashes do not leave a hard-link claim and a delayed owner cannot delete its successor. A live matching owner is never expired by TTL.

## Red flags

- Missing `--pr` on a named-PR command.
- Processing every open PR.
- Rewriting evidence to make preflight green.
- Delegating from the observer to an arbitrary executable preflight script.
- Approval produced by the same queue worker.
- Any GitHub mutation sink inside `manage-pr-queue.mjs`.
- Treating candidate branch behavior as already installed hook behavior.

Any red flag means stop and return `HELD`.
