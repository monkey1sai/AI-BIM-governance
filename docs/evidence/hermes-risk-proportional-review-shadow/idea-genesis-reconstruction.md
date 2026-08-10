# Hermes Risk-Proportional Review — Idea Genesis Reconstruction

> Status: bounded research baseline for a shadow-mode implementation. This file is evidence and design rationale; it is not merge authority and does not prove hosted GitHub enforcement.
>
> Research date: 2026-08-06 (Asia/Taipei)
>
> Baseline observed: `origin/main` at `afa5c7392f2ee630ac222d12a59b1f1087881a87` through GitHub's public view. The execution environment could not obtain a full authenticated clone, so this report does **not** claim exhaustive coverage of all repository history.

## 1. Method

Each evolution chain uses the following order:

```text
observed symptom
→ problem representation
→ initially plausible solution
→ adopted change
→ negative evidence / side effect
→ actual bottleneck
→ conceptual shift
→ new responsibility boundary
→ invariant
```

Claims are labelled:

- `direct_fact`: directly present in a tracked contract, executable implementation, test, PR record, or supplied research material.
- `supported_inference`: an interpretation supported by at least two independent facts.
- `unverified_hypothesis`: plausible, but not established by the inspected evidence.

Chronology alone is not treated as causality.

## 2. Source Coverage

### Repository sources inspected

- `AGENTS.md` and current root repository map.
- `docs/PR_REVIEW_AGENT.md`.
- `docs/agents/advanced-agent-reasoning-contract.md`.
- `docs/agents/github-workflow.md`.
- `docs/agents/self-referential-bootstrap.md`.
- `scripts/lib/task-packet.mjs` and `scripts/tests/task-packet.schema.json`.
- `scripts/lib/pr-review-agent.ps1`.
- `scripts/verification-manifest.json`.
- `.github/workflows/agent-governance.yml`.
- High-signal merged PR records: #453, #456, #459, #469.

### Supplied research material inspected

- Video notes on line-by-line review versus verification gates.
- Q1/Q2/Q3 review grading material.
- Q3 bias and recovery-cost analysis.
- Example PR template, grader script, and GitHub Action integration guide.
- Harness principles: evidence-driven stopping, bounded retry, least privilege, persistent progress, deterministic checks first, trace before graph, narrow tools.

### Coverage limits

- The public repository page reported 685 commits during this run, but the environment could not resolve GitHub from `git`/`curl`; therefore all commits, comments, checks, and issue threads were not exhaustively paginated.
- No live branch-protection, ruleset, reviewer identity, or GitHub App setting was read through an authenticated API.
- GitNexus could not be run because a complete checkout and index were unavailable.
- The supplied attachments are research inputs, not repository authority. Their example scoring, code, labels, and thresholds were not copied as implementation truth.

## 3. Direct Facts

| ID | Fact | Evidence |
|---|---|---|
| F-01 | The repository already routes work through F/B/G/S lanes. F is coordinator-only; B permits at most one optional specialist; G/S are governed and bounded. | `AGENTS.md`; `scripts/lib/task-packet.mjs` |
| F-02 | `task-packet/v2` is closed-schema and bounds read-set, agent count, required evidence, required gates, forbidden actions, and escalation. | `scripts/lib/task-packet.mjs`; `scripts/tests/task-packet.schema.json` |
| F-03 | The current PR review agent is a gate, not a merge bot; optional AI cannot turn a deterministic failure into pass. | `docs/PR_REVIEW_AGENT.md` |
| F-04 | Current PR evidence is base/head aware, and PR #453 bound review findings to immutable Git objects and held the first candidate after six fail-open cases, then found TOCTOU and `.env` dispatch issues in later exact-head closure. | PR #453 |
| F-05 | PR #453 also records bounded reviewer/finding budgets and external reviewer availability limits. | PR #453 conversation and walkthrough |
| F-06 | PR #459 introduced a self-referential bootstrap ledger: a mechanism-changing PR cannot use the new mechanism as its own final trust root and must later close a fixpoint. | PR #459; `docs/agents/self-referential-bootstrap.md` |
| F-07 | PR #469 moved shared phase/HELD/terminal semantics into a machine contract and stopped heavy CI reruns for PR-body-only edits. | PR #469 |
| F-08 | The verification manifest fails closed for unknown paths and treats governance, workflows, contracts, scripts, and verification machinery as governed surfaces. | `scripts/verification-manifest.json` |
| F-09 | The current agent-governance workflow explicitly pins Node and enumerates governance tests rather than discovering arbitrary tests. | `.github/workflows/agent-governance.yml` |
| F-10 | The supplied review research says manual reading can miss intentionally hidden bugs even in a small known region, and green tests can still miss structural duplication of a business rule. | Supplied video notes |
| F-11 | The supplied Q3 research distinguishes code repair effort from business recovery cost and identifies persistent data, blast radius, post-fix residue, and regulated boundaries as separate dimensions. | Supplied Q3 analysis |

## 4. Idea Evolution Chains

### Chain A — From “read every generated line” to risk-proportional attention

**Observed symptom — `direct_fact`**
AI increases code volume faster than human review bandwidth. The supplied review experiment shows expert readers can miss an intentionally hidden defect even when the approximate location is known. Repository PR #453 needed multiple independent closure rounds to expose fail-open, TOCTOU, and pre-validation dispatch flaws.

**Problem representation — `supported_inference`**
The scarce resource is not code generation; it is high-quality semantic attention. Spending that attention uniformly is both expensive and unreliable.

**Initially plausible solution — `direct_fact`**
Require a reviewer or line-by-line read for every task.

**Negative evidence — `direct_fact`**
The repository already makes the Lane B reviewer optional, and PR #453 records external review limits. Uniform reviewer invocation therefore conflicts with both existing lane design and finite reviewer capacity.

**Actual bottleneck — `supported_inference`**
The system lacks a deterministic router that says when mechanical evidence is sufficient and when human/model semantic review has high information value.

**Conceptual shift**
Move review upward from syntax volume to evidence quality, delayed detectability, recovery consequence, topology, and trust surface.

**New boundary**
Deterministic collectors decide facts. A bounded classifier selects review mode. A reviewer answers only risk-specific questions. Existing PR gates and humans retain authority.

**Invariant**
No model reviewer is invoked when exact-head deterministic evidence completely covers a low-consequence local change.

---

### Chain B — From three self-reported scores to evidence-backed dimensions

**Observed symptom — `direct_fact`**
The supplied Q1/Q2/Q3 approach is useful as a conversation frame, but the Q3 material documents optimism, line-count, blast-radius, reversibility, and compliance biases.

**Initially plausible solution — `direct_fact`**
Parse three integers from the PR body, sum them, assign L1-L4, and allow low totals to skip review.

**Negative evidence — `supported_inference`**
A submitter-controlled value can lower its own scrutiny, while the existing repository explicitly prevents optional AI from overriding deterministic failure.

**Actual bottleneck**
The inputs are claims rather than observed facts.

**Conceptual shift**
Keep Q1/Q2/Q3 only as advisory explanation. Deterministic facts derive detectability, horizon, consequence/recovery, topology, evidence strength, and trust surface.

**New boundary**
Submitter/agent claims may escalate a review mode but cannot lower it.

**Invariant**
`claims_policy = escalation_only`.

---

### Chain C — From diff size to change topology and recovery surface

**Observed symptom — `direct_fact`**
The Q3 material notes that a one-line code fix can leave polluted data or regulated consequences, while a large style refactor can remain low consequence.

**Problem representation**
Physical diff size is neither blast radius nor recovery cost.

**Conceptual shift**
Classify topology as local, distributed, contractual, architectural, or unknown; separately classify persistent writes, rollback, external effects, users, services, and post-fix actions.

**New boundary**
Line count is carried only as descriptive packet metadata. It never directly raises or lowers consequence.

**Invariant**
A one-line irreversible or no-clean-rollback write may require human-critical review; a large local generated diff may remain mechanical when exact-head gates are strong.

---

### Chain D — From green tests to structural review

**Observed symptom — `direct_fact`**
The supplied material describes multiple functionally correct, green-test changes that duplicated one business rule across implementations.

**Problem representation**
Behavioral tests can prove examples without proving ownership uniqueness or absence of hidden coupling.

**Actual bottleneck**
Structural risk is a graph/ownership question, not only an assertion question.

**Conceptual shift**
Use impact evidence and changed topology to activate an architecture specialist only when distributed, contractual, architectural, shared, or duplicated-rule signals exist.

**Invariant**
Green tests do not automatically grant `mechanical_only` when topology or rule-ownership signals require semantic inspection.

---

### Chain E — From repeated review attempts to bounded information gain

**Observed symptom — `direct_fact`**
Repository governance already uses HELD/terminal semantics and bounded agents; the Harness research requires bounded retry and evidence-driven stopping.

**Initially plausible solution**
Re-run the reviewer, use a bigger model, or append more context until a pass appears.

**Negative evidence — `supported_inference`**
Repeating an identical evidence set consumes tokens without changing the decision basis and can normalize retry-until-pass behavior.

**Conceptual shift**
Bind each attempt to an evidence fingerprint. Continue only when a bounded delta request produces new evidence.

**New boundary**
At most two attempts and one evidence-delta request; required checks have zero automatic retry.

**Invariant**
An identical evidence fingerprint transitions to `held`, never to another model call.

---

### Chain F — From mutable review context to exact-head truth

**Observed symptom — `direct_fact`**
PR #453 found identity drift and TOCTOU problems and then bound findings to immutable target/base/subject SHAs and pinned Git object reads.

**Conceptual shift**
Review decisions and packets must carry repository, base SHA, head SHA, policy hash, verification-manifest hash, and input hash.

**Invariant**
A new head or policy invalidates the old cycle; stale evidence is not accepted as exact-head evidence.

---

### Chain G — From self-certifying gates to bootstrap/fixpoint trust

**Observed symptom — `direct_fact`**
PR #459 and the tracked bootstrap contract define the trusting-trust problem for changes to evidence harnesses and adjudicating gates.

**Conceptual shift**
A new review router must begin as advisory shadow output. Wiring it into a required/base-owned gate is a separate self-referential change with a ledger entry and post-merge fixpoint.

**Invariant**
This MVP does not edit workflows, branch protection, current PR verdict semantics, or the verification manifest.

---

### Chain H — From full context transfer to bounded review packets

**Observed symptom — `supported_inference`**
The task packet already bounds read sets, and PR #469 reduced unnecessary CI reruns. Full repository/session context conflicts with those cost controls.

**Conceptual shift**
Compile only immutable identity, prioritized changed paths, risk summary, exact evidence references, gaps, and precise review questions.

**Invariant**
Packet overflow is explicit `budget_exceeded`; it cannot silently expand context or invoke another reviewer.

## 5. Existing Authority Map

| Responsibility | Existing owner | Shadow MVP relationship |
|---|---|---|
| Development lane, read-set, agent and gate budgets | `task-packet/v2`, AGENTS/CLAUDE | Consumes lane as a floor; never rewrites it |
| Deterministic PR status and current risk guardrails | `pr-review-agent/v1` and base-owned metadata gate | Produces advisory context only; cannot override pass/fail/block |
| Verification dispatch and configured/not-configured truth | `verification-manifest/v2` | Carries manifest hash and treats missing evidence as a gap |
| Self-referential change debt/fixpoint | bootstrap contract and ledger | Marks the surface human-critical; does not self-certify |
| CODEOWNERS, branch protection, exact-head approval and merge | GitHub settings + humans | Explicitly outside this system |
| Model invocation | Codex/Claude/Hermes adapters | Adapter receives a bounded packet; adapter owns no policy semantics |

## 6. Chosen Responsibility Boundary

```text
Deterministic input facts
  → advisory risk classifier
  → mechanical_only | focused_semantic | risk_scoped_specialists | human_critical
  → bounded packet (only when semantic review is useful)
  → bounded loop with evidence fingerprint
  → advisory output

Existing PR gates + exact-head human/branch protection
  → merge authority
```

The implementation deliberately does **not**:

- add a required GitHub check;
- post labels or comments;
- approve or merge a PR;
- modify branch protection;
- execute reviewer-generated code;
- ingest full prompts, sessions, logs, or repository content;
- copy the supplied score-summing grader.

## 7. Decision Genealogy

| Decision | Rejected alternative | Evidence basis |
|---|---|---|
| Claims can only escalate | Submitter score can grant an exemption | Existing deterministic-failure guardrail + Q3 bias material |
| B lane may still be mechanical | Mandatory reviewer for every B task | Current task packet says B reviewer is optional |
| G/S floor at risk-scoped review | Treat all governed changes as ordinary | Current task packet requires impact/integration and bounded specialists |
| Self-referential floor is human-critical | Let new router certify itself | Bootstrap/fixpoint contract |
| Maximum two model reviewers | Fan out to every specialist | Existing `max_agents=3` includes coordinator |
| Maximum two attempts, one delta | Retry until agreement | Harness bounded-loop rule + HELD semantics |
| Exact-head evidence only | Reuse old successful test/review | PR #453 immutable identity repair |
| Packet overflow stops escalation | Send full repo after cap | Existing bounded read-set philosophy |
| No workflow change in PR-A | Immediately make it required | Current rollout contract says report-only first; gate change is self-referential |

## 8. Unverified Hypotheses

- `unverified_hypothesis`: the four review modes will reduce model-review invocations without increasing escaped defects in this repository. Historical replay and a shadow observation period are required.
- `unverified_hypothesis`: 16 KiB / 24 paths / 16 evidence refs / 6 questions are sufficient packet budgets. They are conservative initial values, not calibrated production thresholds.
- `unverified_hypothesis`: path-based trust signals will have acceptable false-positive rates once GitNexus symbol impact is available.
- `unverified_hypothesis`: Hermes, Codex, and Claude adapters can consume the same packet without vendor-specific semantic drift. Adapter contract tests are required.

## 9. Source Gaps and Next Research Cursor

Next evidence pass should begin at:

1. Authenticated export of all merged PR metadata, review threads, check conclusions, reverts, and follow-up fixes.
2. Historical replay over representative F/B/G/S PRs, including false-positive and false-negative counterexamples.
3. GitNexus impact facts for shared symbols and service boundaries.
4. Hosted observation of packet size, reviewer invocation count, held rate, escaped defects, and post-merge repair.
5. A separate bootstrap-governed PR to wire the test into base-owned CI only after the shadow policy is approved.

No token-saving or defect-reduction percentage is claimed by this baseline.
