# Parallel Delivery Fabric v1 Implementation Plan

> **For Codex/Claude:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task, `superpowers:test-driven-development` for every behavior change, and `superpowers:verification-before-completion` before any completion claim.
>
> **Approved design:** `docs/superpowers/specs/2026-08-28-parallel-delivery-fabric-design.md`
>
> **Execution authorization:** The user approved the design and requested implementation on `codex/docs/parallel-delivery-fabric-spec`. This plan does not grant live GitHub App, branch-protection, merge, deploy, ACL, process-termination, or cleanup authority.

**Goal:** Implement the provider-neutral Parallel Delivery Fabric control plane, exact-SHA evidence contracts, safe local Git-ref registries, Codex/Claude adapters, stack/train/queue simulations, autonomous-review migration seam, and fail-closed activation gates for AC-01 through AC-45.

**Architecture:** Expose one deep module with `submit`, `advance`, `reconcile`, `drain`, `release`, and `inspect`. Keep durable plans and leases in two local-only single-ref CAS registries. Put GitHub, provider launch, board projection, host inventory, Computer Use, review publication, queue, merge, and deployment behind narrow injected ports. Production adapters remain shadow or `HELD` until their external authority is independently activated.

**Tech stack:** Node.js ESM and `node:test`; JSON Schema; PowerShell policy tests; Git plumbing with exact-OID `update-ref`; OpenSpec; GitHub Actions YAML; existing isolated-branch-stack and verification-manifest contracts.

## Global execution constraints

- Work only in `C:\Repos\active\iot\AI-BIM-governance.worktrees\parallel-delivery-fabric-spec`.
- Do not modify, clean, prune, reindex, or compete with the main checkout or another worktree.
- **No per-task commit, no push, and no PR.** Keep every task as an uncommitted, reviewable diff. Only after all tasks, per-task reviews, AC-01..45 checks, final whole-branch review, GitNexus `detect-changes`, and applicable Computer Use verification pass may the coordinator create one final commit, push, and open one PR.
- The SDD ledger records `UNCOMMITTED_PER_USER_RULE`, the task-owned paths, RED/GREEN evidence, and review verdict. Because `HEAD` intentionally does not move, create each task review packet from its pre-task snapshot and task-owned diff; do not use an empty `HEAD..HEAD` range as evidence.
- At most two secondary assignments may be active. Parallel implementers require disjoint file ownership. An implementer never spawns another agent and never edits outside its task list.
- Every executable behavior starts with a failing test, the same test must be observed RED for the intended reason, and the smallest implementation must make it GREEN.
- Before editing an existing function/class/method, run exact-worktree GitNexus 1.6.9 `impact`. Before the final commit, run `gitnexus detect-changes --scope compare --base-ref main`.
- Never call legacy board `register`, `update`, `done`, hooks, or notify from Fabric. The only legacy read is exact `status --json --no-prune`.
- Never call cleanup, detached spawn, process/listener scan, PID termination, `git worktree prune`, branch/worktree deletion, `safe.directory`, ACL/owner/account/firewall mutation, Codex `sandbox.exe` mutation, or installer repair.
- Local tests may mutate only temp repositories, ignored SDD artifacts, and the two declared local Git refs in a dedicated test repo. No Fabric ref is pushed.
- GitHub App, branch protection, Merge Queue, canonical Linux deployment, production, secret broker, and real host inventory remain external. Local fakes must never be reported as live activation.
- A UI-required candidate needs both the existing `E2E_REQUIRE_REAL=1` Playwright evidence and an independent Computer Use verifier bound to the same manifest/head. Governance-only changes may mark Computer Use `NOT_APPLICABLE` only after the base-owned classifier proves there is no user-facing route.

## Per-wave file ownership map

A path is exclusive only within its listed execution wave. A later wave may
modify a shared policy/documentation file only after the earlier task's review
packet is accepted; no two active assignments may own the same path.

| Slice | Exclusive paths |
|---|---|
| Phase 0 governance / Task 1 | `AGENTS.md`, `docs/agents/{github-workflow,self-referential-bootstrap}.md`, `docs/plans/NOW.md`, `openspec/lifecycle-ledger.json`, `openspec/changes/{autonomous-linux-delivery,parallel-delivery-fabric}/**`, approved design status |
| Contracts | `agent-contracts/parallel-delivery-fabric.schema.json`, `scripts/lib/parallel-delivery-fabric-contract.mjs`, contract tests |
| Registry and release | `scripts/lib/parallel-delivery-fabric-registry.mjs`, registry tests |
| Admission and envelopes | `scripts/lib/parallel-delivery-fabric-admission.mjs`, admission tests |
| Provider and host boundaries | `scripts/lib/parallel-delivery-fabric-adapters.mjs`, boundary tests |
| Projection and recovery / Task 6 | `scripts/lib/parallel-delivery-fabric-projection.mjs`, lifecycle tests, `docs/agents/parallel-session-board.md` |
| Stack and train | `scripts/lib/parallel-delivery-fabric-{stack,e2e-binder}.mjs`, stack/train tests |
| Queue and promotion | `scripts/lib/parallel-delivery-fabric-{queue,promotion-bridge}.mjs`, queue/promotion tests, `.github/workflows/ci.yml` |
| Deep module and CLI | `scripts/lib/parallel-delivery-fabric.mjs`, `scripts/dev/parallel-delivery-fabric.mjs`, orchestration tests |
| Review migration / Task 11 | `scripts/autonomous-codex-review-policy.json`, `scripts/tests/autonomous-codex-review-policy.schema.json`, `scripts/tests/test-autonomous-codex-review-policy.mjs`, `scripts/lib/autonomous-codex-review-check.mjs`, and the trusted-review/check files explicitly named in Task 11 only |
| Verification/docs / Task 12 | `AGENTS.md`, `CLAUDE.md`, `docs/agents/{codex-loop-workflows,github-workflow,parallel-session-board,parallel-delivery-fabric}.md`, `agent-contracts/parallel-delivery-fabric-ac-map.json`, `scripts/{verification-manifest.json,SCRIPT_CONTRACT.md,script-registry.json}`, manifest schema/policy tests |

---

### Task 1: Reconcile canonical governance before any live behavior

**AC coverage:** activation prerequisite for all ACs; directly guards AC-14, AC-28, AC-34, AC-36, AC-42.

**Files:**

- Modify: `docs/superpowers/specs/2026-08-28-parallel-delivery-fabric-design.md`
- Create: `openspec/changes/parallel-delivery-fabric/proposal.md`
- Create: `openspec/changes/parallel-delivery-fabric/design.md`
- Create: `openspec/changes/parallel-delivery-fabric/tasks.md`
- Create: `openspec/changes/parallel-delivery-fabric/specs/parallel-delivery-fabric/spec.md`
- Modify: `openspec/changes/autonomous-linux-delivery/proposal.md`
- Modify: `openspec/changes/autonomous-linux-delivery/design.md`
- Modify: `openspec/changes/autonomous-linux-delivery/tasks.md`
- Modify: `openspec/changes/autonomous-linux-delivery/specs/autonomous-linux-delivery/spec.md`
- Modify: `openspec/changes/autonomous-linux-delivery/specs/pull-request-review-agent/spec.md`
- Modify: `openspec/changes/autonomous-linux-delivery/specs/ai-coding-governance/spec.md`
- Modify: `AGENTS.md`
- Modify: `docs/agents/github-workflow.md`
- Modify: `docs/agents/self-referential-bootstrap.md`
- Modify: `openspec/lifecycle-ledger.json`
- Modify: `docs/plans/NOW.md`
- Create: `scripts/tests/test-parallel-delivery-fabric-phase0.mjs`

**Step 1: Write the failing canonical-authority test**

Create a Node test that asserts:

- the approved design status is no longer `Draft`;
- one canonical Fabric OpenSpec exists and declares `shadow -> canary -> active`;
- live policy remains single-writer until an activation record proves cap=2;
- the autonomous-delivery delta contains mutually exclusive `single_pr|direct_stack`;
- `STACK_*` never enters the closed external terminal vocabulary;
- stale fixpoint/reconciliation work is marked superseded without changing the historical lifecycle ledger;
- autonomous Codex review is add-before-remove and source-pinned; the old counted review cannot be retired before the external check is active.
- the review-policy phase is one closed, canonical active-OpenSpec enum:
  `LEGACY_GUARDED -> SHADOW_DUAL -> CUTOVER_ARMED -> CANARY_ACTIVE -> AUTONOMOUS_ACTIVE`;
  every alias or other state is rejected by queue, trust-root, and policy fixtures.
- `openspec/lifecycle-ledger.json` has one new current Fabric introduction
  row with `status=active`, an owner and `phase0-governance` slice,
  task counts, evidence references,
  `subject_commit=df227cc1e07cb0bb6a683ef4c6df6c9f22284529`, and
  `subject_binding=introduction`; `docs/plans/NOW.md` references the same
  active row without representing activation as live delivery.

Run:

`node --test scripts/tests/test-parallel-delivery-fabric-phase0.mjs`

Expected RED: missing `parallel-delivery-fabric` change and stale autonomous-delivery clauses.

**Step 2: Add the smallest canonical delta**

Document one activation record with `phase`, `base_sha`, `policy_digest`, `writer_cap`, `external_check_name`, `external_app_id`, and `activated_at`. Until that record is validated, `writer_cap=1`, stack delivery is `HELD`, and the existing counted review remains live.

Make the historical ledger byte-frozen. Replace future fixpoint/reconciliation tasks with a single ordinary protected PR closure. Add `single_pr|direct_stack` and group saga semantics to the existing autonomous-delivery delta without widening its terminal schema.

Keep the active autonomous-delivery OpenSpec activation enum above as the only
review-migration vocabulary. The new Fabric activation record may reference
that enum but must not introduce aliases; `CUTOVER_ARMED` requires the
external settings lease, source-pinned required CheckRun, disabled sink, exact
rollback snapshot, and authoritative reread before the legacy gate can be
removed. Only a successful disposable canary may advance to
`AUTONOMOUS_ACTIVE`.

Append, rather than rewrite, exactly one current row to
`openspec/lifecycle-ledger.json`. Its fields are
`status=active`, `owner=parallel-delivery-fabric`,
`slice=phase0-governance`, task counts derived from the new change's task
list, evidence references to the new OpenSpec/design/Phase 0 test, and
`subject_commit=df227cc1e07cb0bb6a683ef4c6df6c9f22284529` with
`subject_binding=introduction`. Do not modify any historical row. Update
`docs/plans/NOW.md` to identify this same row as the current Phase 0 work
item and retain its shadow/activation boundary. Keep
`scripts/self-referential-bootstrap-ledger.json` byte-for-byte unchanged.

**Step 3: Validate the two OpenSpec changes**

Run:

- `npx openspec validate parallel-delivery-fabric --strict`
- `npx openspec validate autonomous-linux-delivery --strict`
- `node --test scripts/tests/test-openspec-machine-truth.mjs scripts/tests/test-openspec-machine-truth-cli.mjs`
- `node scripts/tests/verify-openspec-repository-lifecycle.mjs`
- `node --test scripts/tests/test-parallel-delivery-fabric-phase0.mjs`
- `git diff --exit-code -- scripts/self-referential-bootstrap-ledger.json`

Expected GREEN: both changes validate; lifecycle machine-truth tests and
verifier pass; the historical self-referential ledger has no byte diff; and
no live authority is inferred from the design alone.

**Step 4: Produce task review evidence**

Record the task-owned diff and every command outcome in the SDD ledger. A
read-only reviewer must confirm that Phase 0 removes contradictions without
weakening current live protection, appends only the required lifecycle row,
and leaves the self-referential ledger unchanged.

---

### Task 2: Implement the closed Fabric contract and schema

**AC coverage:** AC-06, AC-07, AC-35, AC-38, AC-42, AC-44.

**Files:**

- Create: `agent-contracts/parallel-delivery-fabric.schema.json`
- Create: `scripts/lib/parallel-delivery-fabric-contract.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-contract.mjs`
- Create: `tests/test_parallel_delivery_fabric_schema.py`

**Step 1: Write failing parser/schema tests**

Cover exact-key rejection, bounded identifiers, lowercase 40-hex SHA, RFC3339 timestamps, opaque IDs, canonical JSON digest, secret-field rejection, Windows case-fold path normalization, rename old+new scope capture, shared-contract resource keys, terminal vocabulary projection, and `CONTROL_METADATA` side-effect taxonomy.

Required exported API:

```js
export const FABRIC_SCHEMA_VERSION = 'parallel-delivery-fabric/v1';
export function canonicalize(value) {}
export function digestCanonical(value) {}
export function normalizeScopeResource(resource) {}
export function parseDeliveryPlan(value) {}
export function parseProviderSessionEnvelope(value) {}
export function parseExecutionEnvelope(value) {}
export function parseStackDeliveryEnvelope(value) {}
export function projectExternalTerminal(value) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-contract.mjs`

Expected RED: module/schema do not exist.

**Step 2: Implement pure, side-effect-free validation**

Use exact object-key sets and closed enums. Reject token/cookie/authorization/private-key/raw-env/transcript/raw SID/PID fields recursively. Keep full host identity only behind opaque attestation references.

The schema must expose closed `$defs` for plan, lease, provider session, candidate, managed branch, stack, train, execution envelope, queue observation, handoff, reclaim intent, owner-end release, E2E manifest, and activation record.

**Step 3: Run GREEN and schema regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-contract.mjs`
- `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_parallel_delivery_fabric_schema.py -p no:cacheprovider`
- `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_autonomous_delivery_contract_schemas.py -p no:cacheprovider`
- `node --test scripts/tests/test-autonomous-linux-delivery-contracts.mjs`

Expected GREEN: Fabric accepts only the new internal vocabulary and preserves the existing external terminal vocabulary.

The Node test remains a pure parser and structural-guard suite: it must not spawn Python, consult `PATH`, or depend on `jsonschema`. Draft 2020 schema validation belongs only to `tests/test_parallel_delivery_fabric_schema.py`, which first asserts `jsonschema==4.26.0`, uses `Draft202012Validator` plus an explicit `FormatChecker`, and reads the existing hash-pinned provenance in `.github/workflows/agent-governance.yml`. Task 2 does not modify that workflow or install a dependency.

**Step 4: Review**

Reviewer checks correctness, privacy, canonicalization stability, and that no IO/spawn/network import exists in the contract module.

---

### Task 3: Implement local-only plan and lease CAS registries

**AC coverage:** AC-01–05, AC-43, AC-44.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-registry.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-registry.mjs`

**Step 1: Write failing temp-repository tests**

Cover:

- the only refs are `refs/ai-bim/delivery-plans` and `refs/ai-bim/session-leases`;
- immutable blob + expected-old-OID CAS;
- two racing admissions have exactly one winner;
- Codex + Claude and same-provider sessions share cap=2;
- a third writer is `QUEUED_FOR_LEASE`;
- heartbeat sequence is monotonic;
- timeout becomes `SUSPECT`, never release;
- plan-only writes exactly one plan-index blob and creates no lease/branch/worktree/network call;
- owner-end release needs a fresh trusted attestation, revokes the execution envelope, has no in-flight command, and uses a one-winner CAS;
- release retains branch/worktree for review.

Required ports:

```js
export function createGitCasStore({ git, commonDir }) {}
export function createPlanRegistry({ store, clock }) {}
export function createLeaseRegistry({ store, clock, writerCap = 2 }) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-registry.mjs`

Expected RED: registry module does not exist.

**Step 2: Implement the minimal registry**

Use a sanitized Git environment and an exact command allowlist. Never inspect or write a remote. Do not reuse PR queue lock semantics, stale PID reclaim, board state, or cleanup behavior.

Represent a missing ref with the all-zero expected OID. On CAS conflict, reread and return a typed conflict; never overwrite. Every persisted record includes schema version, generation, nonce, created/updated timestamps, and canonical digest.

**Step 3: Run GREEN and adversarial CAS regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-registry.mjs`
- `node --test scripts/tests/test-pr-queue-adversarial-and-stress.mjs`

Expected GREEN: temp Git races serialize, hooks/ambient Git variables cannot redirect writes, and no cleanup path is reachable.

**Step 4: Review**

Reviewer checks exact ref names, hook/environment isolation, Windows path handling, release anti-replay, and zero remote/process dependency.

---

### Task 4: Implement actual-context, provider, and configuration adapters

**AC coverage:** AC-08, AC-09, AC-35–37, AC-40, AC-45.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-adapters.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-adapters.mjs`

**Step 1: Write failing boundary tests**

Use injected fakes to test Codex and Claude as top-level providers. Reject forged, replayed, expired, wrong issuer, wrong owner, wrong launcher lineage, wrong common-dir/worktree/branch/head/scope, lost host-local mapping, nested CLI, and shared execution context.

Test `CLAUDE_CONFIG_PREFLIGHT` against prior-pinned `.claude/settings.json`: hooks disabled, `defaultMode=plan`, bypass disabled, exact settings/source/policy digest. A candidate or ignored `.claude/settings.local.json` broad allowlist, advisory commit guard, or provider permission-resolution result must not enlarge the command policy; each attempt is `HELD_PROVIDER_CONFIGURATION` before file or network effects.

Required API:

```js
export function verifyExecutionContextAttestation(input, trustedPins) {}
export function verifyOwnerEndAttestation(input, trustedPins) {}
export function verifyClaudeConfiguration(input, trustedPins) {}
export function createProviderAdapter({ provider, attestor, commandPolicy, effects }) {}
export function consumeHostInventoryAttestation(input, trustedPins) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-adapters.mjs`

Expected RED: adapter module does not exist.

**Step 2: Implement fail-closed adapters**

The adapter receives opaque host-local attestation references; it never collects raw account/process identity. Unknown Git ownership, sandbox identity, config source, or host inventory yields a typed `HELD_*` result before writer/file/network effects.

The command policy explicitly denies nested `codex`, `claude`, agent CLI, arbitrary PowerShell, `taskkill`, push, merge, approval, deploy, ACL, installer, sandbox, cleanup, and worktree lifecycle commands.

**Step 3: Run GREEN and existing policy gates**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-adapters.mjs`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1`

Expected GREEN: both providers obey the same tuple/cap boundary and tracked Claude settings remain unchanged.

**Step 4: Review**

Reviewer checks issuer/freshness/replay binding, raw identity privacy, command allowlist closure, and zero provider permission inheritance.

---

### Task 5: Implement admission, scope ownership, managed branches, and execution levels

**AC coverage:** AC-01, AC-02, AC-06, AC-07, AC-10–14, AC-38, AC-39.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-admission.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-admission.mjs`

**Step 1: Write failing admission tests**

Build table-driven cases for Windows case-folded paths, path globs, rename old+new, symbol/API/shared-contract IDs, runtime/browser/train keys, unknown overlap, owner mismatch, duplicate branch/worktree/context, and global writer/runtime capacities.

Add managed-base tests for `develop`, `release/*`, and `hotfix/*`: missing owner/base/protection/generation/expiry freezes; renew/advance/rebase needs owner + dedicated lease + expected current head/base/protection + registry OID + nonce; a candidate writer cannot push or deploy a managed base.

Add execution-level tests for the only adjacent chain:

`plan_only -> implement_local -> push_owned_branch -> open_draft_pr -> submit_delivery`

Reject self-issued envelopes, stale/replayed nonce, non-adjacent jumps, revoked/expired envelopes, wrong expected remote SHA, push to `main` or another branch, bare force, and any direct merge/deploy sink.

Simulate a parent/base SHA update after child evidence exists. Require every
child check, review, train, and E2E packet to become invalid and the child to
enter `REBASE_REQUIRED`. A retry may only use the agent-owned branch with the
previous remote SHA, explicit `force-with-lease`, and a bound range-diff
artifact; a missing or mismatched range-diff rejects handoff before a remote
write.

Required API:

```js
export function normalizeScope(resources) {}
export function findScopeConflicts(left, right) {}
export function evaluateAdmission(snapshot, request) {}
export function renewManagedBranch(record, command) {}
export function advanceExecutionEnvelope(envelope, command) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-admission.mjs`

Expected RED: admission module does not exist.

**Step 2: Implement deterministic, fail-closed decisions**

One session maps one-to-one to owner/provider/session/context/repo/common-dir/worktree/branch/task/scope/lease/generation. Unknown normalization or overlap is never optimistic. Managed bases are coordination metadata, not candidate or deploy sources. Execution decisions return intents; they do not execute Git or network commands.

**Step 3: Run GREEN**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-admission.mjs`
- `node --test scripts/tests/parallel-delivery-fabric/test-contract.mjs scripts/tests/parallel-delivery-fabric/test-registry.mjs`

Expected GREEN: deterministic conflict/transition tables and zero side effects.

**Step 4: Review**

Reviewer checks cap semantics, scope false-negatives, anti-replay, managed-base/candidate separation, and forbidden sinks.

---

### Task 6: Implement projection-only board view and non-destructive recovery

**AC coverage:** AC-03, AC-04, AC-28, AC-29, AC-36, AC-40, AC-43.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-projection.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-lifecycle-boundary.mjs`
- Modify: `docs/agents/parallel-session-board.md`

**Step 1: Write failing lifecycle side-effect tests**

Inject spies for board, process inventory, detached spawn, cleanup, Git worktree/branch lifecycle, ACL/owner, sandbox, installer, firewall, Git remote, and external APIs.

For every operation `start`, `heartbeat`, `handoff`, `end_request`, `release`, `reconcile`, `resume`, assert:

- the only legacy board command allowed is `status --json --no-prune`;
- register/update/done/hooks/notify are rejected;
- stale/malformed/missing board data yields `PROJECTION_DEGRADED` and cannot change lease truth;
- timeout/crash yields `SUSPECT`;
- unknown/stale/malformed HostInventoryAuthority attestation stays `UNKNOWN/HELD`;
- a fresh source-pinned HostInventoryAuthority attestation produces only a
  sanitized reclaim handoff, never a scan, reclaim, kill, delete, prune, or
  ACL operation;
- all destructive/host mutation spy counts stay zero.

Required API:

```js
export function createBoardProjection({ readBoardStatus, writeProjection }) {}
export function reconcileSession({ lease, projection, inventoryAttestation, clock }) {}
export function evaluateResumeIntent({ lease, intent, contextAttestation }) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-lifecycle-boundary.mjs`

Expected RED: projection module does not exist.

**Step 2: Implement the isolated projection seam**

Do not import `agents-board.mjs` or `cleanup-orphan-dev-processes.mjs`. Accept a pre-sanitized board snapshot or an injected exact reader. A projection writer, if used, writes only its own atomic projection path and has no lifecycle callback.

Resume requires an explicit intent and fresh tuple/head/context proof. Reclaim produces only a sanitized external handoff; Fabric never scans or reclaims.

**Step 3: Run GREEN and cleanup regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-lifecycle-boundary.mjs`
- `node --test scripts/tests/test-cleanup-orphan-dev-processes.mjs scripts/tests/test-gitnexus-worktree-health.mjs`

Expected GREEN: Fabric paths cannot reach cleanup even when board input is stale or hostile.

**Step 4: Review**

Reviewer specifically searches imports/call sites for cleanup, lifecycle maintenance, process scan, PID, prune, ACL, and sandbox operations.

---

### Task 7: Implement ordinary/direct-stack simulation and Merge Queue observation

**AC coverage:** AC-15–20, AC-30–32, AC-41, AC-42.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-stack.mjs`
- Create: `scripts/lib/parallel-delivery-fabric-queue.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-stack.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-queue.mjs`
- Modify: `.github/workflows/ci.yml`

**Step 1: Write failing stack and queue tests**

Stack cases:

- only same-repo, fully linear, contiguous lowest-unmerged prefixes;
- freeze the complete ordered PR/base/head/evidence vector before dispatch;
- reject head/base/evidence drift before the fake sink sees a request;
- handle HTTP `200|202|400|403|404|409|422`, pending, timeout, malformed, ambiguous poll, partial merge, and final-vector mismatch;
- `202` stores an operation UUID and remains pending;
- success proves each member is merged, every frozen member head is reachable
  from one `stack_result_merge_commit_sha`, and that SHA equals fresh
  `origin/main`;
- no member becomes `DELIVERED` before the complete group deployment and
  post-deploy verification barrier succeeds; deploy failure projects exactly
  `CLOSED/FAILED/MERGED_NOT_DELIVERED`, freezes admission, and creates a new
  exact-head repair/revert lineage rather than claiming physical rollback;
- arbitrary independent/nonlinear/cross-repo batch requests are rejected with zero mutation.

Queue cases:

- observer consumes a timestamped, source-pinned snapshot only;
- unsupported capability is `HELD_QUEUE_CAPABILITY`;
- `merge_group` SHA cannot impersonate a PR head or deployed SHA;
- capacity `queue: max` preserves one running + 100 pending without replacement;
- reject `queue: max` combined with `cancel-in-progress: true`, any
  candidate-derived concurrency key, and a missing workflow/resource key;
- model the cancelled 101st pending run with its exact candidate/run/lease
  tuple: absent or mismatched mapping is `HELD_QUEUE_CAPABILITY`, never a
  synthetic pending/pass/delivery result;
- rebuilt merge groups invalidate prior evidence;
- observer never enqueues, dequeues, merges, deploys, or publishes checks.

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-stack.mjs scripts/tests/parallel-delivery-fabric/test-queue.mjs`

Expected RED: stack/queue modules do not exist and CI lacks `merge_group` compatibility.

**Step 2: Implement pure transaction planning and observe-only ports**

Expose request builders and response reducers. The production sink remains absent; tests receive recording fakes. Reuse the autonomous-delivery terminal projection without adding `STACK_*` terminal classes.

Add `merge_group` as a CI event only where existing required jobs can evaluate it. Use a queue-safe concurrency key and `cancel-in-progress: false` for shared queue resources; do not enable Merge Queue or change branch protection.

Make the queue test read the relevant `.github/workflows/ci.yml` concurrency
object and reject the invalid cancel/key combinations above. The test must
exercise one running plus two pending preservation and the 101st
candidate/run/lease reconciliation path; `docker compose config -q` is not
evidence that GitHub Actions concurrency syntax or policy is valid.

**Step 3: Run GREEN and existing queue regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-stack.mjs scripts/tests/parallel-delivery-fabric/test-queue.mjs`
- `node --test scripts/tests/test-manage-pr-queue.mjs scripts/tests/test-pr-queue-adversarial-and-stress.mjs scripts/tests/test-autonomous-linux-delivery-contracts.mjs`
- `docker compose config -q`

Expected GREEN: async/group/closed-schema cases pass; existing observer remains fail closed; workflow syntax remains valid.

**Step 4: Review**

Reviewer checks vector CAS, all response classes, logical-vs-physical atomic wording, queue non-authority, and workflow cancellation behavior.

---

### Task 8: Implement integration-train and exact-SHA E2E evidence binding

**AC coverage:** AC-10, AC-21–27, AC-33, AC-35, AC-36.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-e2e-binder.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-train-and-e2e.mjs`
- Modify: `scripts/lib/runtime-e2e-readiness.mjs`
- Modify: `scripts/tests/test-runtime-e2e-readiness.mjs`

**Step 1: Write failing train/runtime/evidence tests**

Cover:

- after exact-worktree GitNexus impact of the existing exported readiness
  predicates, a base-pinned applicability classifier emits an immutable
  `e2e_required` record for route/workflow/shared-runtime changes;
  candidate input cannot downgrade that result, and missing, stale, or
  candidate-sourced records are `HELD_EVIDENCE_BINDING`;
- throw-away train base and ordered inputs are exact SHA and invalidated by drift;
- train commits are never merge/deploy candidates;
- runtime cap allows two writers plus one train or Computer Use lease, never train and Computer Use simultaneously;
- offset, reserved ports, manifest hash, base URL, branch/worktree identity, and runtime identity are frozen;
- Playwright and Computer Use packets must share the same exact head/tree/manifest/runtime digest;
- `E2E_REQUIRE_REAL=1` rejects skip or missing manifest;
- candidate-modified harness is shadow-only;
- trusted verifier/binder source, failure isolation, timeout, manifest/head mismatch, screenshot/trace hash mismatch, and runtime drift all fail closed;
- evidence records route, button, fixture, API, runtime ID, visible state, network result, trace, screenshot, and sanitized command lineage.

Required API:

```js
export function createIntegrationTrain(plan) {}
export function evaluateRuntimeAdmission(snapshot, request) {}
export function classifyE2EApplicability({ change, trustedPolicy, baseSha }) {}
export function bindBrowserEvidence({ candidate, manifest, playwright, computerUse, trustedPins }) {}
```

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-train-and-e2e.mjs`

Expected RED: binder module does not exist.

**Step 2: Implement pure binders around existing launcher contracts**

Do not start/stop services or duplicate the isolated-stack launcher. Consume its manifest and evidence as inputs. Computer Use is a distinct verifier identity; it cannot edit, push, resolve, publish a required check, or merge.

**Step 3: Run GREEN and existing stack-support tests**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-train-and-e2e.mjs`
- `node --test scripts/tests/test-runtime-e2e-readiness.mjs`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack.ps1`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-functional-runtime-result.ps1`

Expected GREEN: binder contracts pass and existing exact-runtime evidence rules remain intact.

**Step 4: Review**

Reviewer checks same-physical-manifest binding, trusted-source pinning, evidence privacy, and that no lifecycle/process adapter was reimplemented.

---

### Task 9: Implement role-separated review and external promotion handoff

**AC coverage:** AC-13, AC-14, AC-25, AC-32–35, AC-38, AC-42.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric-promotion-bridge.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-promotion-bridge.mjs`

**Step 1: Write failing authority-separation tests**

Assert writer, self-diagnostic, independent reviewer, Computer Use verifier, binder, CheckRun publisher, promotion bridge, merge executor, and deployment executor have distinct identities and allowed capabilities.

Require an exact base/head/changed-files/evidence digest and a prior-pinned `monkey1sai-codex/ready` App source. Wrong App, wrong SHA, neutral, skipped, timeout, partial pagination, ambiguous verdict, unresolved finding, candidate-owned publisher, or self-review can never yield success.

The bridge may produce only:

- an ordinary single-PR external handoff; or
- a frozen direct-stack vector handoff.

It cannot push, open a non-draft PR without authority, approve a GitHub review, merge, deploy, modify protection, or access secrets.

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-promotion-bridge.mjs`

Expected RED: bridge module does not exist.

**Step 2: Implement sanitized handoff packets**

Bind plan/generation/base/head/scope/lease/context/worktree/reviewer/verifier/check-source/evidence references and expected authority version. Reject secret-shaped fields recursively. Map every internal stack outcome into the existing external `CLOSED/{HELD|FAILED|DELIVERED}` vocabulary only at the external boundary.

**Step 3: Run GREEN and autonomous-delivery regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-promotion-bridge.mjs`
- `node --test scripts/tests/test-autonomous-linux-delivery-contracts.mjs`

Expected GREEN: only independently proven exact-head candidates produce a handoff; all fake external sink call counts remain zero.

**Step 4: Review**

Use a read-only security/authority reviewer. Any credential overlap, self-review path, or success-like unknown state blocks the task.

---

### Task 10: Implement the deep module, state machine, and shadow CLI

**AC coverage:** integrates AC-01–45 without adding authority.

**Files:**

- Create: `scripts/lib/parallel-delivery-fabric.mjs`
- Create: `scripts/dev/parallel-delivery-fabric.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-orchestrator.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-cli.mjs`

**Step 1: Write failing orchestration tests**

Test the public boundary only:

```js
const fabric = createParallelDeliveryFabric(ports);
await fabric.dispatch({ type: 'submit', command_id: '...' });
await fabric.dispatch({ type: 'advance', command_id: '...' });
await fabric.dispatch({ type: 'reconcile', command_id: '...' });
await fabric.dispatch({ type: 'drain', command_id: '...' });
await fabric.dispatch({ type: 'release', command_id: '...' });
await fabric.inspect(planId);
```

Cover idempotent `command_id`, every valid state transition, unknown states/transitions, cap conflict, context/config failure, projection degradation, scope/head/evidence drift, release, drain, and adapter failure. Unknown/partial results fail closed.

CLI tests accept JSON on a bounded file/stdin port and emit sanitized JSON. Default mode is `shadow`. Live GitHub/merge/deploy/provider-launch flags do not exist.

Run:

`node --test scripts/tests/parallel-delivery-fabric/test-orchestrator.mjs scripts/tests/parallel-delivery-fabric/test-cli.mjs`

Expected RED: deep module and CLI do not exist.

**Step 2: Implement the smallest orchestrator**

Compose the pure contract, registry, admission, adapters, projection, stack/queue, binder, and promotion bridge through dependency injection. Keep the public surface smaller than its implementation. Each command validates its execution envelope before invoking the next allowed port.

Supported CLI commands are exactly `submit`, `advance`, `reconcile`, `drain`, `release`, and `inspect`. The CLI never creates a worktree, launches Codex/Claude, pushes, opens a PR, publishes a check, merges, deploys, or cleans resources.

**Step 3: Run GREEN and combined Fabric tests**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-orchestrator.mjs scripts/tests/parallel-delivery-fabric/test-cli.mjs`
- `node --test scripts/tests/parallel-delivery-fabric/*.mjs`

Expected GREEN: every port call is explainable by an authorized transition and all shadow operations remain local.

**Step 4: Review**

Reviewer applies the deletion test to the deep module and checks state-machine completeness, idempotency, dependency direction, and absence of leaked low-level lifecycle operations.

---

### Task 11: Implement the no-gap autonomous Codex review migration seam

**AC coverage:** AC-14, AC-33, AC-34, AC-36, AC-38.

**Files:**

- Create: `scripts/autonomous-codex-review-policy.json`
- Create: `scripts/tests/autonomous-codex-review-policy.schema.json`
- Create: `scripts/tests/test-autonomous-codex-review-policy.mjs`
- Create: `scripts/lib/autonomous-codex-review-check.mjs`
- Create: `scripts/tests/parallel-delivery-fabric/test-review-migration.mjs`
- Modify: `scripts/dev/manage-pr-queue.mjs`
- Modify: `scripts/lib/trusted-host-merge-evidence.mjs`
- Modify: `scripts/dev/check_governance_trust_root.py`
- Modify: `.github/workflows/governance-trust-root.yml`
- Modify: `scripts/agent-governance-rules.json`
- Modify: `scripts/tests/test-manage-pr-queue.mjs`
- Modify: `scripts/tests/test-trusted-host-merge.mjs`
- Modify: `tests/test_governance_trust_root.py`

**Step 1: Run GitNexus impact before existing-symbol edits**

Against the exact worktree index, inspect every existing exported function that will change in queue, trusted-host evidence, and trust-root validation. A HIGH finding requires explicit test expansion in the task report; CRITICAL stops for user sign-off.

**Step 2: Write failing migration tests**

Model explicit phases:

```text
LEGACY_GUARDED
SHADOW_DUAL
CUTOVER_ARMED
CANARY_ACTIVE
AUTONOMOUS_ACTIVE
```

Create a policy-schema test that parses only
`scripts/autonomous-codex-review-policy.json` and validates it against
`scripts/tests/autonomous-codex-review-policy.schema.json`. The schema and
semantic validator must require the canonical enum and transition order, a
base-pinned OpenSpec digest, the exact App/check source pins, external
activation evidence references, closed object keys, and no secret-shaped
fields. Missing/duplicate/alternate policy files, aliases, unknown phases,
or a policy copied from the candidate source must fail before the queue,
trusted-host, or trust-root consumer sees it.

Assert:

- a writer/fixer execution identity cannot be the reviewer;
- review evidence binds PR/base/head/changed-files digest/reviewer engine/evidence digest;
- only `monkey1sai-codex/ready` from the pinned App ID and exact head can succeed;
- neutral/skipped/timeout/unknown/partial pagination/wrong source/wrong head never pass;
- the publisher capability is checks-only and cannot write contents, approve, or merge;
- `LEGACY_GUARDED` and `SHADOW_DUAL` retain the old counted vote; no
  alias/parallel phase vocabulary is accepted;
- `CUTOVER_ARMED` can remove the old vote only with an external settings
  lease, required source-pinned check, disabled sink, exact rollback snapshot,
  and authoritative reread; `CANARY_ACTIVE` is limited to the disposable
  canary, and only its success permits `AUTONOMOUS_ACTIVE`;
- removal before add is rejected and rollback restores the prior gate before
  disabling the new gate;
- no candidate-controlled activation record can advance a phase.

Run:

`node --test scripts/tests/test-autonomous-codex-review-policy.mjs scripts/tests/parallel-delivery-fabric/test-review-migration.mjs scripts/tests/test-manage-pr-queue.mjs scripts/tests/test-trusted-host-merge.mjs`

Expected RED: enforcement is still hard-coded to the legacy counted review and no activation phase exists.

**Step 3: Implement a base-owned activation switch**

Add the sole closed, base-pinned review-policy snapshot at
`scripts/autonomous-codex-review-policy.json`, validated by
`scripts/tests/autonomous-codex-review-policy.schema.json`, and consumed by
queue/trusted-host/trust-root validators. The default and current phase is
`LEGACY_GUARDED`; every consumer imports the same closed enum from this
canonical OpenSpec-derived policy, and an unknown/alias phase is `HELD`.

Repo code may prepare `SHADOW_DUAL` and validate App CheckRun evidence. It
must not modify branch protection, install/alter the App, access PEM/PAT
material, or deactivate the legacy broker. `CUTOVER_ARMED` and
`CANARY_ACTIVE` are externally evidenced, sink-constrained activation
states; only `AUTONOMOUS_ACTIVE` permits normal delivery without the old
vote. Any attempted local phase transition is `HELD`.

**Step 4: Run GREEN and trust-root gates**

Run:

- `node --test scripts/tests/test-autonomous-codex-review-policy.mjs scripts/tests/parallel-delivery-fabric/test-review-migration.mjs scripts/tests/test-manage-pr-queue.mjs scripts/tests/test-trusted-host-merge.mjs`
- `python -m pytest tests/test_governance_trust_root.py -p no:cacheprovider`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1`

Expected GREEN: the sole committed policy source and schema validate, the
target autonomous review path is implemented, and current live enforcement
cannot develop a gap.

**Step 5: Security review**

Use a read-only security reviewer. Verify App permission separation, source/head pinning, no self-review, no bypass, no secret handling, and a reversible add-before-remove sequence.

---

### Task 12: Wire verification, operator documentation, and script contracts

**AC coverage:** machine coverage and operator visibility for AC-01–45.

**Files:**

- Create: `docs/agents/parallel-delivery-fabric.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/agents/codex-loop-workflows.md`
- Modify: `docs/agents/github-workflow.md`
- Modify: `docs/agents/parallel-session-board.md`
- Modify: `scripts/verification-manifest.json`
- Modify: `scripts/SCRIPT_CONTRACT.md`
- Modify: `scripts/script-registry.json`
- Create: `agent-contracts/parallel-delivery-fabric-ac-map.json`
- Create: `scripts/tests/parallel-delivery-fabric/test-static-policy.mjs`
- Create: `scripts/tests/test-parallel-delivery-fabric-static-policy.ps1`

**Step 1: Write failing static/manifest tests**

Assert:

- all Fabric modules/tests/CLI are registered and covered by an enforced local target;
- docs distinguish current live policy, shadow implementation, and activation target;
- cap=2 cannot activate without the canonical record;
- Claude settings/hook policy stays pinned;
- legacy board writes and cleanup are absent from the Fabric call graph;
- `monkey1sai-blip` is described only as the temporary legacy gate during add-before-remove migration, not human judgment or target authority;
- Computer Use applicability and exact-SHA evidence fields are documented;
- Task 12 reads and validates the sole review-policy source
  `scripts/autonomous-codex-review-policy.json` and its committed schema;
  it must not create, merge, or accept an alternate policy source;
- `agent-contracts/parallel-delivery-fabric-ac-map.json` has exactly the
  closed IDs `AC-01` through `AC-45`; every entry maps a positive, negative,
  or no-side-effect assertion to a registered test file and literal
  `test('AC-XX — …')` name;
- every mapped test file is in the enforced Fabric target, every mapped test
  name exists exactly once in its source, and no AC is satisfied by prose or
  ignored SDD evidence alone;
- script registry and verification manifest remain schema-valid.

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-static-policy.mjs`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-parallel-delivery-fabric-static-policy.ps1`

Expected RED: new entries and docs are missing.

**Step 2: Add the narrow verification target and docs**

Register a Fabric gate that runs the dedicated Node/Python/PowerShell tests without starting runtime or accessing network. Read and validate the Task 11 policy/schema as an immutable input; do not add a second policy document, policy writer, or policy-source fallback. Explain shadow commands, state meanings, external activation prerequisites, recovery, retention, and rollback. Keep AGENTS/CLAUDE lazy-load budgets within their existing limits.

Create the permanent AC map with this closed shape:

```json
{
  "schema_version": "parallel-delivery-fabric-ac-map/v1",
  "acceptance": [
    {
      "id": "AC-01",
      "assertions": [
        {
          "kind": "positive",
          "test_file": "scripts/tests/parallel-delivery-fabric/test-registry.mjs",
          "test_name": "AC-01 — cross-provider admission is bounded"
        }
      ]
    }
  ]
}
```

The static-policy test must reject duplicate/missing/out-of-range IDs,
unregistered files, absent/non-literal test names, and map entries whose test
is not selected by the enforced Fabric verification command. Each executable
AC test title starts with its mapped `AC-XX` identifier; the SDD
`ac-map.md` remains review evidence only and is not the source of truth.

**Step 3: Run GREEN and manifest regressions**

Run:

- `node --test scripts/tests/parallel-delivery-fabric/test-static-policy.mjs`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-parallel-delivery-fabric-static-policy.ps1`
- `node scripts/tests/test-verification-plan.mjs`
- `node scripts/tests/test-verification-runner.mjs`
- `node scripts/tests/test-verification-command-policy.mjs`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1`

Expected GREEN: configuration, docs, and verification source of truth agree.

**Step 4: Review**

Reviewer checks no target-state statement is presented as live proof, no optional mock is counted as production evidence, and no global config change is introduced.

---

### Task 13: Run full acceptance, independent reviews, and final delivery

**AC coverage:** final evidence for AC-01–45.

**Files:**

- Modify only review-driven fixes within the task owner that introduced the finding.
- Write ignored evidence only under `.superpowers/sdd/2026-08-28-parallel-delivery-fabric-implementation/`.

**Step 1: Run the complete fresh local verification**

From the exact worktree, with no test result reused from an earlier head:

- TODO (Task 13 owner): wire `tests/test_parallel_delivery_fabric_schema.py` into the existing hash-pinned `jsonschema==4.26.0` job in `.github/workflows/agent-governance.yml`; Task 2 reads that tracked pin but does not modify workflow wiring.
- `node --test scripts/tests/parallel-delivery-fabric/*.mjs`
- `node --test scripts/tests/parallel-delivery-fabric/test-contract.mjs`
- `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_parallel_delivery_fabric_schema.py -p no:cacheprovider`
- `C:\Repos\active\iot\AI-BIM-governance\.venv\Scripts\python.exe -m pytest tests/test_autonomous_delivery_contract_schemas.py -p no:cacheprovider`
- `node --test scripts/tests/test-autonomous-linux-delivery-contracts.mjs scripts/tests/test-manage-pr-queue.mjs scripts/tests/test-pr-queue-adversarial-and-stress.mjs scripts/tests/test-trusted-host-merge.mjs`
- `python -m pytest tests/test_governance_trust_root.py -p no:cacheprovider`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-parallel-delivery-fabric-static-policy.ps1`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-agent-governance-check.ps1`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-isolated-branch-stack.ps1`
- `pwsh -NoProfile -NonInteractive -File scripts/tests/test-functional-runtime-result.ps1`
- `node scripts/tests/test-verification-plan.mjs`
- `node scripts/tests/test-verification-runner.mjs`
- `node scripts/tests/verify-openspec-repository-lifecycle.mjs`
- `npx openspec validate parallel-delivery-fabric --strict`
- `npx openspec validate autonomous-linux-delivery --strict`
- `npx openspec validate --all --strict`

Record exact exit codes and concise outputs. Skipped checks are gaps, never passes.

**Step 2: Preserve the true Phase 2 canary boundary**

Do not treat temp-repository, injected-provider, or unit-test evidence as the
design's cross-provider canary. Before the final commit, record a
`PHASE2_CANARY_HELD` activation packet unless an externally authorized,
post-merge activation environment exists.

The post-merge canary procedure, owned by the external activation authority,
uses one Codex App top-level task and one externally launched Claude CLI
top-level session in separate assigned sibling worktrees. It requires fresh
actual-context preflight, different owner/provider/session/context/branch/
worktree/scope tuples, two heartbeat samples per writer with at least 30
seconds of overlap, disjoint exact-head commit/check evidence, a queued third
writer, and a stopped-heartbeat-only crash fixture that leaves the other
writer running. The procedure may never kill a PID, stop `sandbox.exe`, or
clean a resource. Its unavailable, mismatched, or failed result remains
`HELD_EXTERNAL_ACTIVATION`; local implementation must not claim AC-01/08
activation proof from it.

**Step 3: Classify and, if applicable, run Computer Use**

Use the base-owned change classifier. If no user-facing route/runtime changed, record `E2E_NOT_APPLICABLE` with classifier evidence; do not manufacture a UI test.

If applicable, read the Computer Use guidance and confirmations, obtain the exact isolated-stack manifest, run `E2E_REQUIRE_REAL=1` Playwright, and have an independent Computer Use verifier operate the same exact-head UI. Record route, button, fixture, API, runtime ID, visible state, screenshot/trace, manifest hash, and verifier identity. Any unavailable runtime or mismatch is `HELD`.

**Step 4: Run per-task and whole-branch reviews**

Every task must have a spec-compliance review followed by a code-quality/security review. Findings go to the original implementer or a fresh scoped fixer, then receive a fresh review packet. The coordinator does not silently fix reviewer findings.

Finally request one whole-branch reviewer against the original implementation baseline. Resolve every P0/P1 and every in-scope P2 before proceeding.

**Step 5: Run GitNexus and cleanliness gates**

Run:

- `gitnexus detect-changes --scope compare --base-ref main`
- `git diff --check`
- `git status --short --branch`

Verify all changed paths are expected, no secret/test artifact is tracked, main remains clean, and the task worktree contains only the intended final diff.

**Step 6: Only now commit, push, and open one PR**

Create one Conventional Commit:

`feat(governance): 建立多工作樹並行交付控制面`

Push only `codex/docs/parallel-delivery-fabric-spec`. Open one Traditional-Chinese PR with the required engineering sections, explicit shadow/live boundary, AC evidence, held external activation gates, Computer Use applicability, risks, and rollback.

Watch required checks. Do not approve or merge the PR from the candidate session. The external autonomous-delivery authority remains the only merge/deploy sink.

## Execution waves and review packets

```text
Wave 0: Task 1
Wave 1: Task 2
Wave 2: Task 3 + Task 4 (disjoint files)
Wave 3: Task 5 + Task 6 (disjoint files)
Wave 4: Task 7 + Task 8 (disjoint files)
Wave 5: Task 9
Wave 6: Task 10
Wave 7: Task 11
Wave 8: Task 12
Wave 9: Task 13
```

Each task packet under `.superpowers/sdd/2026-08-28-parallel-delivery-fabric-implementation/task-N/` contains:

- `brief.md`
- `scope.md`
- `red.log`
- `green.log`
- `diff.patch`
- `ac-map.md`
- `implementer-report.md`
- `review-request.md`
- `review-result.md`

The shared `progress.md` is append-only and records task status, owned paths, uncommitted diff identity, checks, review verdict, uncertainty, and next task. No task is complete merely because implementation code exists.

## Completion boundary

Local implementation is complete only when every locally executable AC
contract leg has a passing permanent AC-map test, all mock/shadow evidence is
labeled accurately, external authority prerequisites are represented as
fail-closed activation gates, and the final review has no unresolved blocking
finding. The true Phase 2 Codex/Claude canary, App/protection cutover, and
live cap=2 proof are activation evidence, not assertions that an uncommitted
or locally simulated branch may make.

Live cap=2 activation, GitHub App installation/permission changes, branch-protection migration, Merge Queue enablement, canonical Linux deployment, and production canaries are deliberately not performed by this plan. Their absence must remain visible as `HELD_EXTERNAL_ACTIVATION`; it is not a reason to weaken or bypass the old gate.
