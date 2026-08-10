# Hermes Risk-Proportional Review Control Plane — Shadow Mode

> Document type: advisory agent-tooling contract and runbook.
>
> This capability does not replace `task-packet/v2`, `pr-review-agent/v1`, `verification-manifest/v2`, CODEOWNERS, branch protection, or exact-head human approval.

## 1. One-sentence definition

A vendor-neutral Harness component that performs deterministic risk classification first, compiles the smallest sufficient review packet only when semantic review has information value, and stops after bounded evidence-producing attempts.

## 2. Why this is a Harness component

```text
Harness policy core
  ├─ closed policy and input contracts
  ├─ deterministic risk facts
  ├─ packet/context budgets
  ├─ exact-head identity
  ├─ result validation
  └─ stop/retry semantics

Bounded loop
  trigger → collect → classify → verify → packet → optional review → decide

Graph / multi-agent orchestration
  introduced later, only after traces show stable branches worth encoding

Project implementation
  BIM services, frontend, runtime, storage, and GitHub remain outside the policy core
```

The implementation follows seven engineering rules:

1. Evidence, not model confidence, decides whether work may stop.
2. Retry is bounded and must produce new evidence.
3. Adapters receive narrow capabilities and cannot change policy.
4. Identity, progress, and evidence are serializable across sessions.
5. Deterministic checks run before any model reviewer.
6. Observe traces before expanding into a graph of agents.
7. Tools and packets remain narrow by default.

## 3. Existing authority is preserved

| Existing authority | Ownership retained |
|---|---|
| F/B/G/S routing and agent/read-set budgets | Root governance plus `task-packet/v2` |
| Required verification and configured/not-configured truth | `verification-manifest/v2` |
| Current deterministic PR pass/warn/block/fail | `pr-review-agent/v1` and base-owned metadata checks |
| Self-referential bootstrap and fixpoint | Existing bootstrap ledger/gate |
| Approval and merge | CODEOWNERS, humans, branch protection, GitHub settings |

The new classifier consumes `lane` as a floor. It may increase scrutiny, but it cannot lower the existing lane or change a deterministic result.

The policy, schema, classifier, CLI, tests, golden/sample fixtures, and this runbook classify as self-referential surfaces. A future integration PR must therefore use the pre-change base-owned mechanism and the repository's bootstrap/fixpoint protocol.

## 4. Review dimensions

The classifier does not reproduce the supplied three-score sum. It derives six independent dimensions from bounded facts.

| Dimension | Machine question | Typical escalation signal |
|---|---|---|
| Detectability | Is a real detector observed on this exact head? | Claimed CI without a passing exact-head result |
| Detection horizon | When would the first reliable detector fire? | Weeks, months, customer/audit discovery |
| Consequence/recovery | What remains after the code itself is fixed? | Persistent data, no clean rollback, refund, reconciliation, notification, legal report |
| Change topology | Is repair local, distributed, contractual, architectural, or unknown? | Shared callers, schema/API changes, service/trust ownership changes |
| Evidence strength | Are all required evidence kinds passed on the exact head? | Missing, not configured, not observed, stale, failed |
| Trust surface | Does the change alter protected or adjudicating authority? | Auth, secrets, permissions, verification gates, policy, branch/governance mechanisms |

Physical diff size is descriptive only. It is not a consequence score.

## 5. Review modes

| Mode | Model-review budget | Intended use |
|---|---:|---|
| `mechanical_only` | 0 | Local, low-consequence change with strong exact-head deterministic evidence |
| `focused_semantic` | 1 | One bounded semantic uncertainty or incomplete local understanding |
| `risk_scoped_specialists` | 2 | Distributed, contractual, runtime, or other governed risk; only triggered specialists run |
| `human_critical` | up to 2 advisory specialists plus human | Self-referential, protected, irreversible, regulated, architectural-authority, or critical recovery surface |

Lane floors:

```text
F → mechanical_only floor
B → mechanical_only floor; reviewer remains optional, as in task-packet/v2
G → risk_scoped_specialists floor
S → risk_scoped_specialists floor
```

A Lane B task is not forced to call a reviewer when exact-head deterministic evidence is complete and no semantic risk signal exists. It still requires an exact-head `impact_result`; optional semantic review does not waive the repository's deterministic impact-analysis floor. This is intentional token control and remains compatible with the existing optional B reviewer.

## 6. Machine contracts

### Policy

- `agent-contracts/risk-proportional-review.contract.json`
- `agent-contracts/risk-proportional-review.contract.schema.json`

Hard properties:

- `authority = advisory_shadow`
- `merge_authority = false`
- submitter/agent claims are `escalation_only`
- required-check retries = 0
- maximum loop attempts = 2
- maximum evidence-delta requests = 1
- self-referential floor = `human_critical`

### Input and output schema

- `scripts/tests/review-risk.schema.json`

Covered objects:

- `review-risk-input/v1`
- `review-risk-decision/v1`
- `review-packet/v1`
- `review-result/v1`
- `review-loop-input/v1`
- `review-loop-decision/v1`
- `review-risk-corpus/v1`

Unknown fields fail validation. Absolute paths, dot segments, empty segments, surrounding whitespace, controls, and trailing separators are rejected; relative Windows separators remain valid and normalize before classification. Prompts, sessions, environment variables, stdout/stderr, and raw repository content are not part of the input contract.

## 7. Exact-head identity

A decision binds:

```text
repository
base_sha
head_sha
policy_sha256
verification_manifest_sha256
input_sha256
```

A packet adds `packet_sha256`. Before accepting a reviewer result, the adapter revalidates the packet's closed shape, final serialized byte count, and content hash. A reviewer result must match both the packet hash and head SHA. New head, policy, normalized input, or verification-manifest identity requires a new cycle; evidence from another head is `stale`, not passed.

PR-A validates `repository` as a closed `owner/name` slug, but does not authenticate that slug against a hosting provider. Before invoking this library, a trusted adapter must compare the provider-supplied repository identity with its configured scope. Hosted identity and artifact-provenance binding remain PR-B work; a caller-supplied slug or digest is not proof by itself.

## 8. Bounded review packet

Default caps:

| Resource | Cap |
|---|---:|
| Serialized packet | 16 KiB |
| Changed paths | 24 |
| Evidence references | 16 |
| Questions | 6 |

The packet contains only:

- immutable identity;
- selected risk-prioritized changed paths;
- risk summary;
- selected exact evidence references;
- evidence gaps;
- selected specialists;
- precise review questions;
- explicit budget accounting.

It never includes a full chat, prompt, repository, diff, log stream, or session history. A cap violation returns `budget_exceeded`; the adapter must not silently widen the packet.

Evidence `ref` values are inert repository-local artifact identifiers with the form `artifacts/<path>/<file.ext>`. They are not URLs, command arguments, free-form instructions, or permission to dereference a path. The adapter owns artifact lookup and provenance verification before it marks evidence as passed.

Production service paths require exact-head integration and runtime evidence. Two or more distinct production service roots deterministically raise the topology classification to at least `distributed`, even when submitter-provided impact counts claim a local change. Frontend paths additionally require independent `browser_artifacts` operability proof and `design_fidelity_result` visual-fidelity proof; neither substitutes for the other. A renamed path carries `previous_path`, and both source and destination participate in risk classification.

## 9. Reviewer contract

A reviewer is read-only. `review-result/v1` enforces:

- packet hash and exact-head binding;
- only a selected role may answer the packet;
- maximum 6 question answers and 8 findings;
- `implementation_modified = false`;
- `policy_override_attempted = false`;
- every cited evidence reference must already exist in the bounded packet;
- `advisory_clear` requires complete question coverage backed only by exact-head passed packet evidence;
- `advisory_clear` is forbidden with confirmed, in-scope `fix_now` findings;
- `fix_required` requires at least one confirmed, in-scope `fix_now` finding;
- `held` or `unverified` requires exactly one bounded evidence request object;
- unverified and refuted findings cannot masquerade as confirmed fixes.

Finding disposition vocabulary:

```text
fix_now
external_blocker
known_gap
follow_up
refuted
unverified
```

Only `confirmed + in_scope + fix_now` is a repair-loop candidate.

## 10. Bounded loop

```text
COLLECT
→ CLASSIFY
→ VERIFY
→ COMPILE_PACKET
→ OPTIONAL_REVIEW
→ DECIDE
→ COMPLETE / HELD
```

An attempt records:

- exact head, policy, normalized input, and verification-manifest identity;
- evidence fingerprint;
- action;
- expected new evidence;
- observed new evidence;
- decision.

Stop rules:

- an evidence-collection or continuing attempt with an identical evidence fingerprint → `held`;
- an evidence-collection or continuing attempt with no observed new evidence → `held`;
- a first action other than deterministic verification, an attempt appended after any terminal decision, or more than one evidence-delta request → rejected as malformed;
- two attempts exhausted → `held`;
- changed head, policy, normalized input, or verification manifest inside one cycle → `held`, start a new exact-identity cycle;
- terminal advisory/human/block decision → complete; a terminal model/human review may reuse the exact deterministic evidence fingerprint and report no new evidence because its verdict is not itself evidence.

A larger model, repeated reviewer, or more context is not accepted as “new evidence.”

## 11. CLI

All commands are local, advisory, and use Node standard library only. Input paths must resolve inside the repository. The CLI is stdout-only and exposes no filesystem write option; adapters that persist checkpoints own that separate, trusted write boundary.

```powershell
# Classify a bounded fact input
node scripts/dev/review-risk-shadow.mjs evaluate `
  --input scripts/tests/fixtures/review-risk-sample.json

# Build a bounded packet
node scripts/dev/review-risk-shadow.mjs packet `
  --input artifacts/review-risk/input.json

# Validate a reviewer response
node scripts/dev/review-risk-shadow.mjs validate-result `
  --packet artifacts/review-risk/packet.json `
  --result artifacts/review-risk/result.json

# Advance the bounded loop
node scripts/dev/review-risk-shadow.mjs loop `
  --input artifacts/review-risk/loop.json

# Replay the golden corpus
node scripts/dev/review-risk-shadow.mjs replay `
  --corpus scripts/tests/fixtures/review-risk-golden.json

# Verify policy identity
node scripts/dev/review-risk-shadow.mjs policy-hash
```

The CLI exits non-zero only for malformed input/contract or a failed golden replay. A high-risk or human-critical classification does not itself become a merge-blocking exit code in shadow mode.

## 12. Adapter behavior

### Common adapter algorithm

```text
1. Collect bounded deterministic facts.
2. Run evaluate.
3. If verdict is blocked or held: do not invoke a reviewer; repair/collect evidence.
4. If mode is mechanical_only: record the decision and stop model review.
5. Build packet.
6. If packet is budget_exceeded: do not widen context; hold or route to human.
7. Invoke only the selected reviewer role with the packet JSON.
8. Validate review-result/v1.
9. Advance the bounded loop.
10. Return advisory output to the existing PR review flow.
```

Before step 1, the adapter must bind the provider-supplied repository identity, policy, verification manifest, and artifact provenance to its configured run. PR-A's local hashes detect internal inconsistency; they do not authenticate caller-supplied files across a process boundary.

### Hermes

Hermes may act as the outer execution adapter, but it receives no repository-wide prompt and owns no policy semantics.

Allowed:

- execute the local CLI;
- independently validate packet bytes/hash before dispatch;
- supply a validated packet to a selected read-only reviewer;
- persist packet/result/loop JSON as checkpoint state;
- request one bounded evidence delta;
- return advisory output.

Forbidden:

- use `--yolo` or bypass approvals;
- edit implementation while acting as reviewer; the result boolean is an attestation, not a sandbox boundary, so the adapter must enforce read-only tools;
- change policy, budgets, verdict meaning, lane, or evidence status;
- post approval, merge, change GitHub settings, or treat a model consensus as evidence;
- copy full Codex/Claude/Hermes session history into the packet.

### Codex and Claude

Codex and Claude use the same JSON contracts. Their project skills should be thin wrappers that call the CLI and load only the resulting packet. No duplicated risk table should be placed independently in `AGENTS.md`, `CLAUDE.md`, or vendored skills.

## 13. Shadow rollout

### PR-A — this implementation

- policy, schemas, deterministic classifier;
- packet/result/loop contracts;
- 20-case golden corpus plus a standalone sample input;
- local CLI and 64 focused tests;
- evidence/design documentation;
- no workflow or merge-authority change.

### PR-B — historical replay and telemetry

- collect representative historical PR facts;
- compare legacy and shadow decisions;
- record false-positive/false-negative concerns;
- bind hosted repository identity, policy/manifest digests, packet origin, and artifact provenance in the trusted adapter;
- no PR comments or labels.

### PR-C — base-owned advisory integration

This is self-referential. It must:

- add its own bootstrap ledger entry;
- use the pre-change base-owned mechanism as trust root;
- run as report-only/no-op-success where appropriate;
- close a post-merge fixpoint in a later PR.

### PR-D — possible enforcement

Only after an observed calibration period and explicit owner approval. Enforcement must extend the current PR authority rather than create a competing required check.

## 14. Verification

```powershell
node --check scripts/lib/risk-proportional-review.mjs
node --check scripts/dev/review-risk-shadow.mjs
node --test scripts/tests/test-review-risk.mjs
node scripts/dev/review-risk-shadow.mjs replay `
  --corpus scripts/tests/fixtures/review-risk-golden.json
```

Expected local baseline for PR-A:

- 20/20 golden cases pass;
- 64/64 focused Node tests pass;
- schemas validate as Draft-07;
- `git diff --check` passes;
- no workflow, current gate, ledger, CODEOWNERS, or verification manifest is modified.

## 15. Non-claims

This shadow implementation does not claim:

- measured token savings;
- reduced escaped-defect rate;
- complete repository-history reconstruction;
- live GitHub enforcement;
- hosted runner provenance;
- GitNexus impact pass;
- Hermes runtime installation or global configuration.
