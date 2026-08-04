# self-referential-bootstrap-gate — bootstrap evidence

`stack_kind=self_referential_bootstrap`

This evidence was produced **on the PR branch**, not through the canonical
mechanism. Per `docs/agents/self-referential-bootstrap.md` §2 it must not be
cited as deploy-target evidence or as `isolated_branch_stack` evidence; the
three stack kinds do not imply one another.

## Why the pre-change mechanism cannot produce it

This PR *introduces* the bootstrap gate. Its base (`main`) has no
`scripts/lib/self-referential-bootstrap.ps1`, no ledger, and no gate wiring in
`check-pr-body-evidence.ps1`. The PR Metadata Contract job materialises the
checker **pinned at the base SHA** so a PR cannot adjudicate itself with its own
edited gate — which is the correct rule, and it is precisely what makes this PR
unadjudicable pre-merge: the base-pinned checker has no gate to run at all.

`scripts/lib/detect-base-gate-capability.sh` reports this as
`incomplete: base has no scripts/lib/self-referential-bootstrap.ps1`, and the
workflow then requires exactly what this entry provides — a `yes` declaration
with a self-registered open ledger entry.

There is no ordering that avoids this: any PR that adds a gate has a base
without that gate. That is the compiler-bootstrap fixpoint, not a defect.

## What was run

Captured output: [`gate-suites.txt`](gate-suites.txt) — the three suites that
adjudicate this mechanism, four surrounding governance/static regression
suites, and the detector's Bash syntax check, run against
`tested_head=4505eef73b9fcce1dfda97865bd9875c5dba46f6` with their real exit codes.
The follow-up evidence commit changes only files in this evidence directory; it
does not claim that an untested code tree passed.

| Suite | Covers |
|---|---|
| `test-self-referential-bootstrap.ps1` | ledger integrity, base-vs-head transition, exact-case mechanism classification, deletion / impersonation / forged-fixpoint refusals, closure-PR evidence freshness, referenced-evidence deletion protection, ALL-declared-path fixpoint closure, and wire-up through the real `check-pr-body-evidence.ps1` |
| `test-base-gate-capability.ps1` | the capability detection above — that "base has the gate" means the library exists, the checker dot-sources the canonical path rather than a same-named decoy, invokes it with exact ordered provenance for every load-bearing input, and rejects assignment, provider, unary, indirect, and member-mutation bypasses |
| `test-preflight-prnumber-forwarding.ps1` | the PR number reaching the gate, without which entry-to-PR binding cannot be enforced |
| `test-agent-governance-check.ps1` | the aggregate governance contracts, including the review-agent and supporting script tests |
| `test-pr-body-evidence.ps1` | PR metadata/body validation and bootstrap-gate integration |
| `test-pr-review-agent.ps1` | review-agent workflow and trust-boundary regression checks |
| `invoke-powershell-static.ps1` / `bash -n` | PowerShell Error-severity static analysis and detector shell syntax |

## What is still owed

The fixpoint (obligation 3). After this PR merges, the same adjudication must be
re-run through the **post-change canonical mechanism** and the result committed
to this entry's `fixpoint` field. Until then the entry stays `open` and the debt
gate blocks the next mechanism-touching PR. Tracked as task B12 in
`docs/plans/remote-linux-test-deploy-target.plan.md`.
