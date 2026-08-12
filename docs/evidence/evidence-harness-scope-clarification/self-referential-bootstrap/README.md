# evidence-harness-scope-clarification — bootstrap evidence

文件性質：working note（bootstrap 審計工件；merge 後受 base-evidence 不可變規則保護）

`stack_kind=self_referential_bootstrap`

This evidence was produced **on the PR branch** (PR #521), not through the
canonical mechanism. Per `docs/agents/self-referential-bootstrap.md` §2 it must
not be cited as deploy-target evidence or as `isolated_branch_stack` evidence;
the three stack kinds do not imply one another.

## Why the pre-change mechanism cannot produce it

This PR edits the gate's own contract prose
(`docs/agents/self-referential-bootstrap.md`, adding §2.1 scope boundary and
the promotion rule). The contract document is classified by
`Get-SelfReferentialMechanismPaths` as mechanism surface AND listed in
`$script:SelfReferentialAdjudicatorPaths`: contract prose changes what
reviewers and fixpoint PRs are required to prove, so a PR editing it cannot be
accepted under `bootstrap=no` — that would let the changed rule validate
itself (`scripts/lib/self-referential-bootstrap.ps1:72-84`,
`Assert-SelfReferentialBootstrapBody`).

The base-pinned body checker enforces the **base** version of the contract.
Before merge there is no canonical mechanism that adjudicates any PR under the
*post-change* contract text; the clarified scope only becomes the live rule
once merged. No ordering avoids this — it is the same fixpoint shape as the
`self-referential-bootstrap-gate` entry (PR #459), restricted here to prose.

This change deliberately does NOT touch the machine pattern list: the
clarification narrows the documented scope to match what
`Get-SelfReferentialMechanismPaths` already implements, records the PR #511
scope ruling (issue #520), and adds the promotion rule for future gate-wiring
PRs.

**Scope extension (2026-08-12, owner direction).** Issue #494's
regression-repair lane was folded into this PR rather than opened as a second
bootstrap entry, so that both changes share one debt entry and one fixpoint
cycle instead of two. The PR therefore now also changes the gate library
(`scripts/lib/self-referential-bootstrap.ps1`) and its suite
(`scripts/tests/test-self-referential-bootstrap.ps1`), and the entry's declared
`verification_mechanism_paths` grew from two to those four paths accordingly.
The pattern list itself is still untouched.

The post-merge fixpoint therefore has two things to prove, not one: that the
gate suites still pass on `main` with the new prose in place (contract text and
classifier behavior remain consistent), and that they still pass with the new
repair lane live in the library — including the lane's own admission and
refusal cases, which `test-self-referential-bootstrap.ps1` now carries.

## What was run

Captured command results: [`gate-suites.txt`](gate-suites.txt) — the four
suites named by this entry's `verification_contract`, run on the PR branch at
the `tested_head` recorded in that file, with observed exit codes.
The follow-up evidence commit changes only files in this evidence directory;
it does not claim that an untested code tree passed.

Earlier runs hit stale-checkout EOL false reds in
`test-agent-governance-check`: skill-mirror files and the spec-to-done port
helper were CRLF in the working tree while their index blobs were identical
LF on both mirror sides (the raw-byte strict mirror comparison is by design,
per `test-agent-skills-sync`). All `i/lf w/crlf` files under `.claude/` and
`.codex/` were rewritten from their index blobs (973 files, repo tree
unchanged) and the full four-suite run was repeated; `gate-suites.txt`
records that final run.

| Suite | Covers |
|---|---|
| `test-self-referential-bootstrap.ps1` | ledger schema, immutable verification contract, base-vs-head transition, classifier path regression (every mechanism path reaches the debt gate) |
| `test-pr-body-evidence.ps1` | PR metadata/body validation and bootstrap-gate integration (the adjudicator this contract binds) |
| `test-agent-governance-check.ps1` | aggregate governance contracts, including the base-only checkout that pins adjudication to the base contract |
| `invoke-powershell-static.ps1` | PowerShell Error-severity static analysis over `scripts/` |

## What is still owed

The fixpoint (obligation 3). After PR #521 merges, the same four suites must be
re-run on `origin/main` through the post-change canonical mechanism and the
result committed to this entry's `fixpoint` field with a strict attestation.
Until then the entry stays `open` and the debt gate blocks the next
mechanism-touching PR. Tracked in issue #520.
