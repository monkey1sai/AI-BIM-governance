# ADR: Route PR Review Signals by Authority and Cost

> 文件性質：**architecture decision record**。本文件記錄 PR review 訊號的治理決策；目前行為仍以 GitHub live settings、workflow、程式碼與可執行 tests 為準。

## Status

Revised on 2026-08-14 after the self-referential bootstrap debt was closed and
the repository's review traffic was re-audited. This revision replaces the
2026-08-11 decision to retain one automatic CodeRabbit review.

## Context

The repository currently mixes several kinds of PR signal:

- GitHub branch protection requires ten deterministic contexts. These remain the merge gate.
- The `CI` workflow also contains non-required design and runtime evidence jobs. A failure can make the workflow look red without changing branch-protection truth, but the failure remains real evidence and must not be described as a pass.
- CodeRabbit had been narrowed to one initial automatic review. The later audit still found that automatic Copilot, CodeRabbit, and connector reviews overlapped while deterministic checks and the fixed human approval remained authoritative.
- The risk-proportional review contract is `advisory_shadow` with `merge_authority=false`. It classifies findings and escalation; it does not approve, resolve, or merge a pull request.
- `scripts/self-referential-bootstrap-ledger.json` has no open entry. CI and Agent Governance can therefore be simplified in a separate self-referential change with its own bootstrap and fixpoint evidence.

This decision changes advisory review routing and adds a last-push approval
requirement without disabling stale-review dismissal. It does not change product
runtime behavior, deployment behavior, required check names, approval count, or
the Windows and Linux verification boundary.

## Adversarial Grilling Record

The repository owner pre-authorized the recommended answer for each question. Luna gathered the first-layer evidence, Terra challenged the proposed simplification, and a Sol apex reviewer adjudicated the final scope.

| Question | Recommended answer | Strongest objection | Adjudication |
|---|---|---|---|
| Disable automatic CodeRabbit review? | Yes; opt in with `ai-review-ready` or a manual command. | Removing automatic coverage can miss an early defect. | Deterministic checks remain required, while one deliberate final review avoids repeated low-signal rounds. |
| Disable automatic Copilot review? | Yes; retain manual reviewer requests. | Automatic review provides early feedback. | Manual review remains available when the change benefits from it; it is not merge authority. |
| How should Codex review run? | At most one final batch after deterministic checks are green and review threads are resolved. | A late-only review may find a defect near merge time. | Keep it advisory and fail closed on unresolved P0/P1 findings; do not loop the connector on every push. |
| Promote risk-proportional review to merge authority? | No; retain `advisory_shadow`. | Automated dispositions could reduce manual review work. | Only `confirmed + in_scope + fix_now` is a repair candidate. The disposition never overrides deterministic gates or human approval. |
| De-duplicate CI and Agent Governance now? | Yes, but in a separate self-referential slice. | `test-agent-governance-check.ps1` is executed in both workflows. | Preserve the required `agent-governance` context and event coverage; remove only the duplicate CI execution with explicit bootstrap/fixpoint evidence. |
| Ignore non-required failures or bypass the Linux fixpoint? | No. | They do not appear in the ten protected contexts. | Compare base and head honestly. A non-required failure can be out of scope for this PR but is never converted into a pass or a full-system readiness claim. |

## Decision

### 1. Preserve merge authority while avoiding approval churn

Keep the ten required contexts:

1. `agent-governance`;
2. `root contracts and fakes`;
3. `coordinator build and tests`;
4. `governance-service tests`;
5. `viewer build and tests`;
6. `kit-manager-api tests`;
7. `kit-manager-web build`;
8. `docker compose config`;
9. `powershell static analysis`;
10. `secret pattern scan`.

CODEOWNERS, conversation resolution, stale-review dismissal, and one independent
approval remain required. Branch protection additionally requires the most
recent reviewable push to be approved by someone other than the pusher. This
preserves the existing exact-head contract and adds an explicit last-pusher
separation.

### 2. Make CodeRabbit explicitly opt in

The repository-local `.coderabbit.yaml`:

- sets `reviews.auto_review.enabled: false`;
- sets `reviews.auto_review.auto_incremental_review: false`;
- uses the `ai-review-ready` label as the only automatic opt-in trigger;
- sets `reviews.high_level_summary: false`.

CodeRabbit therefore runs only after an explicit label or the manual
`@coderabbitai review` / `@coderabbitai full review` command. The label is
applied only when deterministic checks are green and the author considers the
head ready for one final advisory batch. Removing the label does not weaken any
required gate.

CodeRabbit remains non-required and has no merge authority.

### 3. Route deeper AI review once, at the final head

Use `@codex review` at most once for a ready, exact-head pull request after
required checks are green and review conversations are resolved. If the
connector cannot be triggered on demand, pause its automatic activity, request
one final brokered batch, then leave it paused. Connector exit status alone is
not evidence of success; the final stdout/result and GitHub review state must be
inspected.

The local tri-adversarial review and risk-proportional shadow may classify findings as `fix_now`, `external_blocker`, `known_gap`, `follow_up`, `refuted`, or `unverified`. Only a confirmed, in-scope `fix_now` finding enters a repair loop. These tools produce evidence; they do not supply the required independent approval.

### 4. Preserve platform verification ownership

- The developer Windows machine remains the authority for affected GPU, web, Kit, and browser E2E evidence.
- The canonical Linux target remains the deployment test zone.
- Documentation and reviewer-configuration-only changes do not claim either platform passed. The scope engine may mark those gates out of scope, but it may not weaken them.

### 5. Isolate structural CI changes

Do not mix `ci.yml`, Agent Governance, the PR review agent, the verification
manifest, or CODEOWNERS into this reversible reviewer-routing change. The
ledger prerequisite is now satisfied, so a separate self-referential change
may evaluate all of the following together:

- preserve post-merge coverage while removing genuinely duplicate execution;
- keep protected context names stable;
- separate non-required heavy evidence from the aggregate red/green CI signal without hiding failures;
- keep the verification manifest as the single path-to-gate planner;
- retain Windows GPU/web/Kit evidence and canonical Linux deployment checks.

## Considered Options

### Keep CodeRabbit defaults

Rejected. Live evidence shows repeated reviews, PR-body mutation, and rate-limit noise.

### Keep one automatic AI review

Rejected after the 2026-08-14 audit. It continued to create overlapping review
traffic without adding merge authority. The explicit `ai-review-ready` label
and manual commands retain deliberate advisory coverage.

### Replace CodeRabbit with automatic Codex review

Rejected for this phase. Repository connection and effective behavior have not yet been observed, and another automatic reviewer could reproduce the same noise rather than reduce it.

### Change CI and reviewer routing in one PR

Rejected. It combines a reversible advisory configuration with self-referential merge machinery while an earlier mechanism debt is still open.

## Consequences

### Positive

- Automatic Copilot and CodeRabbit reviews no longer run on every eligible PR.
- A single final CodeRabbit batch remains available through `ai-review-ready`.
- CodeRabbit no longer rewrites the structured PR body with a high-level summary.
- Stale approvals are still dismissed, and the last reviewable push also needs an independent approval.
- Deterministic checks, owner review, and platform evidence retain their current authority.
- The future CI simplification boundary and prerequisite are explicit.

### Negative

- Authors must deliberately request an AI review when it is useful.
- This first phase reduces reviewer noise but does not reduce CI job fan-out or runner time.
- Codex on-demand behavior remains an external integration and must be verified from its final result, not assumed from process exit status.
- Existing non-required design and runtime failures remain open product-readiness evidence.

## Verification

The first phase is accepted only when:

1. the repository change contains only `.coderabbit.yaml` and this ADR;
2. the YAML parses and matches the official CodeRabbit schema;
3. an unlabeled PR does not receive an automatic CodeRabbit review;
4. applying `ai-review-ready` or posting `@coderabbitai review` triggers one review;
5. personal and repository rules do not automatically request Copilot review;
6. branch protection has `dismiss_stale_reviews=true` and `require_last_push_approval=true`, while approval count, CODEOWNERS, conversation resolution, and the ten contexts remain unchanged;
7. `@codex review` runs at most once on a final head or is reported as unavailable without weakening any gate;
8. all ten protected contexts pass at the exact head;
9. non-required base and head failures are compared and reported without being promoted to passes;
10. `git diff --check` and the repository-local PR preflight pass.

This ADR is synchronized from the live GitHub and workflow inspection performed
on 2026-08-14. GitHub settings and third-party service behavior can drift and
must be rechecked before a later enforcement change.

External behavior references:

- [CodeRabbit automatic review controls](https://docs.coderabbit.ai/configuration/auto-review)
- [CodeRabbit PR summaries](https://docs.coderabbit.ai/pr-reviews/summaries)
- [Codex GitHub code review](https://learn.chatgpt.com/codex/third-party/github)
- [GitHub Copilot automatic code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)
- [GitHub protected-branch review settings](https://docs.github.com/en/rest/branches/branch-protection#update-pull-request-review-protection)

## Rollback

Revert `.coderabbit.yaml` and this ADR to restore one automatic CodeRabbit
review. In GitHub settings, re-enable Automatic Copilot code review if desired;
for branch protection, leave `dismiss_stale_reviews=true` and set
`require_last_push_approval=false`. No data migration or runtime restart is
required.
