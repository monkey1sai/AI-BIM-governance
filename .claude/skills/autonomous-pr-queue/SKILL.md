---
name: autonomous-pr-queue
description: Use when one named AI-BIM-governance PR must enter Draft-first, source-pinned, exact-head machine finalization and bounded Linux delivery.
argument-hint: "<prNumber>（必要）"
---

# Named PR delivery queue

## Core rule

Operate on exactly one named PR. Repository code and the coordinator may collect, validate, repair, and report evidence, but they do not hold the external App check-write, merge, deployment, or credential-broker authority. Missing external authority is `HELD`; never replace it with a review vote, admin bypass, candidate workflow, token prompt, or native auto-merge. This tracked skill does not prove that the external App, protected executor, canonical Linux runner, or user-level installation is active.

## Delivery sequence

1. During Draft-first preparation, collect advisory findings and run affected checks. Draft observations do not consume the ready-state budget and cannot publish a passing merge gate.
2. When the PR becomes ready, update the base and scope once, then establish a single-writer head freeze on the exact repository, PR, base OID, head OID, changed-path digest, policy digest, and settings epoch.
3. Collect every server-authoritative connection with complete bounded pagination: changed files, checks and App sources, reviews, review threads, protection or ruleset state, and OpenSpec alignment. Missing pages, cursor loops, unknown fields, binary or submodule ambiguity, secret-bearing review bytes, or tuple drift are `HELD`.
4. Run deterministic gates before model judgment. The highest-risk lane is `critical_machine_adjudication`: L1 finds, a different allowed model performs refute-by-default L2, and L3 rereads the immutable raw packet and closes G1-G12. Required reviewer unavailability or surviving HIGH/CRITICAL risk is `HELD`.
5. Disposition every CI and review finding as `FIX`, `REJECT`, `ACCEPT_RISK`, or `DEFER`. `FIX` requires confirmed, in-scope, current-head repair and regression evidence; `REJECT` requires reproducible refutation; `ACCEPT_RISK` is limited to policy-eligible non-blocking risk; `DEFER` requires out-of-scope status and a same-repository follow-up Issue. Confirmed in-scope P0/P1/P2/BLOCKER/CRITICAL/HIGH findings require `FIX`. Thread resolution means disposition is complete, not that every finding changed code.
6. Round 1 collects the entire blocker batch. If blockers exist, the coordinator may push one batch repair head; that push invalidates every old check, review, thread, and verdict.
7. Round 2 reviews only that batch repair head. The transaction allows at most two review rounds and must not start a third head. A residual blocker, second writer, incomplete evidence, or another repair requirement closes `HELD/PREMERGE_EVIDENCE_INVALID`.
8. Finding convergence precedes the machine gate: complete pagination, valid dispositions, resolved threads, and server unresolved count zero must bind the frozen head first.
9. Only the expected source-pinned external App's actual `success` on that same head is eligible. `neutral` and `skipped` are not a pass for this gate; wrong-source checks, statuses, comments, reviews, old-head results, or publisher absence cannot unlock merge.
10. The privileged finalizer may consume a short-lived single-use lease only after a final server reread matches the exact tuple, then use compare-and-swap `sha=<frozen head>`. If the external sink is unavailable, report `HELD`; repository helpers must not simulate the mutation.
11. After merge, keep the delivery lock until freshly fetched `origin/main` equals the observed merge commit and that exact commit passes canonical Linux rebuild and applicable runtime verification. Only then is the terminal class `DELIVERED`.

The current repository queue helper remains read-only and named-PR scoped:

```powershell
node scripts/dev/manage-pr-queue.mjs status --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs run-queue --pr <prNumber>
```

Compatibility mutation commands always return `HELD` and perform no GitHub mutation:

```powershell
node scripts/dev/manage-pr-queue.mjs auto-fix --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs update-branch --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs approve --pr <prNumber>
node scripts/dev/manage-pr-queue.mjs merge --pr <prNumber>
```

These observers are not the external finalizer and must not become a second controller.

## Bounded polling

Run one named-PR observation at a time. If the PR still needs CI, review, or external authority, let the caller or product wait mechanism wake and invoke another pass; this repository does not start a persistent watcher process:

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
- Any GitHub mutation sink inside `manage-pr-queue.mjs`.
- Treating candidate branch behavior as already installed hook behavior.
- Treating incomplete pagination, `neutral`, `skipped`, or an old-head result as a pass.
- Starting a third review head or a second controller.

Any red flag means stop and return `HELD`.
