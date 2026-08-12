# ADR: Route PR Review Signals by Authority and Cost

> 文件性質：**architecture decision record**。本文件記錄 PR review 訊號的治理決策；目前行為仍以 GitHub live settings、workflow、程式碼與可執行 tests 為準。

## Status

Accepted on 2026-08-11 for a non-enforcement first phase. CI mechanism changes remain held until the open self-referential bootstrap debt is closed through its canonical fixpoint.

## Context

The repository currently mixes several kinds of PR signal:

- GitHub branch protection requires ten deterministic contexts. These remain the merge gate.
- The `CI` workflow also contains non-required design and runtime evidence jobs. A failure can make the workflow look red without changing branch-protection truth, but the failure remains real evidence and must not be described as a pass.
- CodeRabbit currently uses its defaults. Live PR evidence showed repeated reviews on one pull request, an automatic high-level summary that rewrites the PR body, and a review-rate-limit warning.
- The risk-proportional review contract is `advisory_shadow` with `merge_authority=false`. It classifies findings and escalation; it does not approve, resolve, or merge a pull request.
- `scripts/self-referential-bootstrap-ledger.json` contains the open `linux-test-deploy-verifier-hardening` entry. The debt gate blocks another change to `ci.yml`, Agent Governance, the PR review agent, or the verification manifest until a separate canonical Linux fixpoint closes that entry.

This decision does not change product runtime behavior, deployment behavior, branch protection, required approvals, or the Windows and Linux verification boundary.

## Adversarial Grilling Record

The repository owner pre-authorized the recommended answer for each question. Luna gathered the first-layer evidence, Terra challenged the proposed simplification, and a Sol apex reviewer adjudicated the final scope.

| Question | Recommended answer | Strongest objection | Adjudication |
|---|---|---|---|
| Disable CodeRabbit completely? | No; retain an independent automatic review signal. | Repeated reviews, summaries, and rate limits make complete removal the cleanest option. | Keep one initial automatic review. Full removal would lower independent coverage. |
| How should CodeRabbit be narrowed? | Disable incremental review and the high-level PR-body summary. | A later commit can introduce a defect that the initial review will not see. | Accept the narrower default; request a fresh review explicitly after a material revision. |
| Replace CodeRabbit with `@codex review` or make Codex required? | No; use Codex only as an on-demand high-signal review. | Codex focuses GitHub comments on P0/P1 issues and may be less noisy. | Keep it advisory and on demand until the repository connection is observed live; it cannot replace tests, protection, or approval. |
| Promote risk-proportional review to merge authority? | No; retain `advisory_shadow`. | Automated dispositions could reduce manual review work. | Only `confirmed + in_scope + fix_now` is a repair candidate. The disposition never overrides deterministic gates or human approval. |
| De-duplicate CI and Agent Governance now? | No; hold all mechanism changes. | `test-agent-governance-check.ps1` is executed in both workflows. | The jobs have different event coverage and manifest bindings, and the open bootstrap debt blocks this mechanism change. |
| Ignore non-required failures or bypass the Linux fixpoint? | No. | They do not appear in the ten protected contexts. | Compare base and head honestly. A non-required failure can be out of scope for this PR but is never converted into a pass or a full-system readiness claim. |

## Decision

### 1. Preserve merge authority

Do not change branch protection or the ten required contexts:

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

CODEOWNERS, conversation resolution, stale-review dismissal, and the independent approval requirement remain unchanged.

### 2. Keep one automatic CodeRabbit review

Add a repository-local `.coderabbit.yaml` that:

- keeps `reviews.auto_review.enabled: true`;
- sets `reviews.auto_review.auto_incremental_review: false`;
- sets `reviews.high_level_summary: false`.

This retains one independent initial review while preventing automatic review on every push. It also prevents the automatic PR-description summary when the body does not intentionally contain the `@coderabbitai summary` placeholder. After a material revision, a reviewer may explicitly request `@coderabbitai review` or `@coderabbitai full review`.

CodeRabbit remains non-required and has no merge authority.

### 3. Route deeper AI review by risk

Use `@codex review` as an on-demand review for a ready, exact-head pull request when the change is high risk or an additional P0/P1-focused opinion is useful. The GitHub integration must be observed live before it is treated as available.

The local tri-adversarial review and risk-proportional shadow may classify findings as `fix_now`, `external_blocker`, `known_gap`, `follow_up`, `refuted`, or `unverified`. Only a confirmed, in-scope `fix_now` finding enters a repair loop. These tools produce evidence; they do not supply the required independent approval.

### 4. Preserve platform verification ownership

- The developer Windows machine remains the authority for affected GPU, web, Kit, and browser E2E evidence.
- The canonical Linux target remains the deployment test zone.
- Documentation and reviewer-configuration-only changes do not claim either platform passed. The scope engine may mark those gates out of scope, but it may not weaken them.

### 5. Hold structural CI changes

Do not edit `ci.yml`, Agent Governance, the PR review agent, the verification manifest, CODEOWNERS, or branch protection in this phase.

After the existing bootstrap debt is closed in a ledger-only fixpoint PR, a separate self-referential change may evaluate all of the following together:

- preserve post-merge coverage while removing genuinely duplicate execution;
- keep protected context names stable;
- separate non-required heavy evidence from the aggregate red/green CI signal without hiding failures;
- keep the verification manifest as the single path-to-gate planner;
- retain Windows GPU/web/Kit evidence and canonical Linux deployment checks.

## Considered Options

### Keep CodeRabbit defaults

Rejected. Live evidence shows repeated reviews, PR-body mutation, and rate-limit noise.

### Disable all automatic AI review

Rejected. It removes the independent event-triggered review and relies on the PR author or owner remembering to request an advisory reviewer.

### Replace CodeRabbit with automatic Codex review

Rejected for this phase. Repository connection and effective behavior have not yet been observed, and another automatic reviewer could reproduce the same noise rather than reduce it.

### Change CI and reviewer routing in one PR

Rejected. It combines a reversible advisory configuration with self-referential merge machinery while an earlier mechanism debt is still open.

## Consequences

### Positive

- One independent automatic CodeRabbit review remains available.
- Normal follow-up pushes no longer consume automatic incremental reviews.
- CodeRabbit no longer rewrites the structured PR body with a high-level summary.
- Deterministic checks, owner review, and platform evidence retain their current authority.
- The future CI simplification boundary and prerequisite are explicit.

### Negative

- A material follow-up commit requires an explicit fresh review request.
- This first phase reduces reviewer noise but does not reduce CI job fan-out or runner time.
- Codex GitHub review availability remains unverified until a live PR responds to `@codex review`.
- Existing non-required design and runtime failures remain open product-readiness evidence.

## Verification

The first phase is accepted only when:

1. the diff contains only `.coderabbit.yaml` and this ADR;
2. the YAML parses and matches the official CodeRabbit schema;
3. the PR receives one initial automatic CodeRabbit review using the repository configuration;
4. the PR body omits the `@coderabbitai summary` placeholder and CodeRabbit does not append a high-level summary;
5. a later ordinary push does not trigger an automatic incremental review, or this remains an explicitly reported post-merge canary gap;
6. `@codex review` either produces a review or is reported as unavailable without weakening any gate;
7. all ten protected contexts pass at the exact head;
8. non-required base and head failures are compared and reported without being promoted to passes;
9. `git diff --check` and the repository-local PR preflight pass.

This ADR is synchronized from the live GitHub and workflow inspection performed on 2026-08-11. GitHub settings and third-party service behavior can drift and must be rechecked before a later enforcement change.

External behavior references:

- [CodeRabbit automatic review controls](https://docs.coderabbit.ai/configuration/auto-review)
- [CodeRabbit PR summaries](https://docs.coderabbit.ai/pr-reviews/summaries)
- [Codex GitHub code review](https://learn.chatgpt.com/codex/third-party/github)

## Rollback

Revert `.coderabbit.yaml` and this ADR. CodeRabbit then returns to the effective repository or organization defaults. No data migration, runtime restart, deployment change, branch-protection update, or CI workflow rollback is required.
