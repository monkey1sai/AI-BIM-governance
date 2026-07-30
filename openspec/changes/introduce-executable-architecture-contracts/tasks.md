# Tasks: Introduce Executable Architecture Contracts

## Phase 1 — Desired architecture and canonical validation

- [x] 1.1 Add `architecture/architecture-contract.json` with service, browser, data residency, readiness, invariant, delta, and exception contracts.
- [x] 1.2 Add Draft-07 JSON Schemas for architecture contract and architecture delta.
- [x] 1.3 Add the change's own `architecture/deltas/introduce-executable-architecture-contracts.json`.
- [x] 1.4 Implement standard-library semantic validation for cross-object constraints.
- [x] 1.5 Add fail-closed unit/contract tests for canonical success and negative cases.
- [x] 1.6 Wire architecture paths into the existing verification manifest's root-contract, agent-governance, and security dispatch.
- [x] 1.7 Document source-of-truth positioning, agent workflow, exceptions, and ratchet rollout.

## Phase 1 closeout still required in the real checkout

- [x] 1.8 Run `openspec validate introduce-executable-architecture-contracts --strict`.
- [ ] 1.9 Run canonical `scripts/verify-all` planning and affected gates in the real Windows checkout.
- [ ] 1.10 Run GitNexus `detect-changes --scope compare --base-ref main` and record the result.
- [x] 1.11 Independent architecture review confirms the contract preserves current repo boundaries and does not over-claim observed conformance.

### Closeout evidence — 2026-07-30

- 1.8 passed change-specific strict validation; `openspec validate --all --strict` also passed 71 items with 0 failures.
- 1.9 remains open: `verify-all -PlanOnly` selected root contracts, agent governance, and secret/security gates; root contracts passed 181 tests and both secret/security checks passed, but the canonical run failed on pre-existing agent-skill integrity drift outside this change.
- 1.10 remains open: the command ran with the current checkout selected explicitly, but the index was stale and untracked payload files were not mapped; `No changes detected` is advisory, not an accepted gate pass.
- 1.10 invocation follow-up (2026-07-31): the earlier failure mode is now understood. `detect-changes` aborts with `Multiple repositories indexed` unless the checkout is disambiguated, because several worktrees of this repo are indexed under the same label. With `--repo "C:\Repos\active\iot\AI-BIM-governance"` the command completes and reports `Risk level: low`, `Affected processes: 0`. The task stays unchecked: the index still predates the new files, so only Markdown symbols were mapped and the Python modules added by Phase 2 are absent. The result is advisory, not a gate pass.
- 1.11 passed independent review after schema-instance enforcement was added and its missing-required/additional-property counterexamples were proven fail-closed.

## Phase 2 — Observed architecture ratchet

- [x] 2.1 Export service/module dependency observations ~~from GitNexus~~ into a deterministic report. **Deviation: GitNexus replaced by a standard-library static scan — see delivery note below.**
- [x] 2.2 Compare desired, intended, and observed dependency edges.
- [x] 2.3 Establish an approved baseline for existing cycles and forbidden edges.
- [x] 2.4 Fail on any new dependency edge not declared by contract + delta.
- [x] 2.5 Fail on any increase in cycle count or baseline violations.

### Phase 2 delivery notes — 2026-07-30

**Declared deviation (2.1).** The task text named GitNexus as the observation
source. GitNexus is not used as a gate input: its CLI has been repeatedly
observed to fail with transport errors and to serve a stale index (recorded in
`docs/plans/NOW.md`, S4-B closeout, "GitNexus: detect_changes 三次 Transport
closed, index stale"), which cannot back a fail-closed CI gate. The observation
is produced instead by a standard-library static scan
(`scripts/lib/observed_architecture.py`), matching the existing architecture
validator's no-production-dependency rule. GitNexus is recorded as
`advisory_only_sources` in `architecture/observed-graph.config.json`. The task
outcome — a deterministic observed dependency report — is unchanged; the source
of the observation is not.

**What the gate does and does not claim.**

- Service-level edges come from two low-false-positive signals only: schemed URL
  literals (`http/https/ws/wss://host:port`) resolved through the contract's own
  port ownership, and compose `depends_on` / env URLs. Runtime-resolved addresses
  are invisible to a static scan, so `web-viewer-sample → bim-streaming-server`
  is permitted by the contract but absent from the observed graph. The ratchet
  therefore blocks *new statically detectable* edges; it does not claim to have
  enumerated every real call.
- CORS / allowed-origin / CSP lines are suppressed, because an inbound
  allowlist is not an outbound dependency. Without this, `KIT_MANAGER_CORS_ORIGINS`
  produced a false `kit-manager-api → bim-review-coordinator` edge and a false
  service-level cycle.
- Cycle detection runs on the service graph plus each service's internal module
  graph. Cross-service module graphs are out of scope.
- `apps/kit-manager-web` reaches coordinator `:8004` but is not a declared
  contract service. It is recorded as `undeclared-node` debt in
  `architecture/observed-baseline.json`, owned by this change and targeted at
  Phase 3. Declaring the node is a desired-architecture change and needs its own
  delta; it must not be resolved by re-baselining.

**Baseline approved on 2026-07-30**: 7 service edges (5 contract-declared,
2 undeclared-node debt) and 3 module-level cycles (streaming Kit extension
entry point, governance `diff_engine`, viewer `App`/`Window`/`StreamOnlyWindow`),
each with an owner, reason, and target phase.

**`ARCH-GRAPH-001` moved from `planned` to `active`.** The "Honest phased
enforcement" requirement in this change's spec delta previously said the invariant
SHALL remain planned; it is modified in the same PR to define when activation is
permitted (an executable gate in canonical verification, an approved baseline with
attributed debt, and documented scope limits). Activating it without that spec
change would have contradicted this change's own normative text.

**Three-layer adversarial review findings fixed before merge.** Independent
reviewers found five ways the gate could report `passed` without actually
enforcing anything. All are fixed and covered by regression tests:

1. A file containing valid-but-non-object JSON (`null`, `[]`, `123`) made the
   loader return zero issues, so `echo null > observed-baseline.json` produced a
   green run. Non-object documents now raise explicit errors, and `RatchetResult`
   carries a `compared` flag so a run that never reached the comparison cannot
   report `passed`.
2. Relative imports in a package without `__init__.py` resolved to `.sibling` and
   were dropped, leaving `kit-manager-api` with an empty module graph and its
   cycle budget unenforceable. Fixed; that service now has 9 module edges.
3. Suppression patterns were matched against the raw line including comments, so
   a trailing `// not a CORS thing` silently deleted a real edge. Suppression now
   runs on comment-stripped code (`tokenize` for Python).
4. A baseline entry short-circuits the contract check, and `status` was never
   verified — mislabelling a forbidden edge as `declared` bypassed everything.
   Declared entries are now checked against the contract.
5. A mistyped or renamed scan root silently scanned nothing. Missing roots now
   fail closed.

Also fixed: the TypeScript scanner treated `</h1>` as a regex literal and
`<code>/api/kit/*</code>` as a block-comment opener, either of which silently
erased every dependency in the rest of a file; delta declarations used a global
`added - removed` difference, so one historical removal permanently vetoed any
later legitimate re-declaration; and unreadable or unparseable files were skipped
without a trace.

A third independent verification round re-tested every fix and found four more:

6. The two `*.schema.json` files were themselves unvalidated, so replacing one
   with `null` disabled all `required` / `enum` / `additionalProperties` checks
   while still reporting `passed`. Corrupt schema files now fail, and the
   baseline's `status` enum, debt attribution, and duplicate-pair checks are
   additionally enforced in Python so a single corrupt file cannot disable them.
7. Emptying a service's `inbound_edge_ports` removed it from the port ownership
   map, making every future call to it invisible instead of flagged — with no
   error or warning. Services must now either declare inbound ports or be marked
   `browser_client`.
8. A `.py` file containing a NUL byte crashed the scan with an uncaught
   `ValueError` (`read_text` accepts NUL, `ast.parse` rejects it) instead of
   producing a structured finding.
9. In a region the scanner declined to strip, the `//` inside `http://` was read
   as a line-comment opener and erased the rest of the line, including any real
   dependency after it. `://` is now never a comment opener.

The same round confirmed by differential testing against two independently
written implementations (2000 random graphs) that the iterative Tarjan SCC
implementation is correct, and confirmed byte-identical repeat runs.

**Known limits, not claimed as solved**: the TypeScript scanner is a heuristic
state machine, not a parser. Its `clean` flag catches structural failures
(unterminated block comment or template) but cannot detect every misread. The
canonical-repository test is a snapshot of today's tree and is not a
mutation-detection net; that role belongs to the constructed negative tests.

**Verification**: `python -m pytest tests -q` — 283 passed on the real Windows
checkout (was 237 before this change's tests, 181 before Phase 1); the canonical
ratchet passes against a baseline generated on Linux, confirming cross-platform
byte parity. `python scripts/dev/export_observed_architecture.py --strict`
PASSED (205 files, 7 edges, 3 cycles, 0 errors, 0 warnings).

## Phase 3 — Language-specific structural contracts

- [ ] 3.1 Add TypeScript dependency-cruiser rules for UI/application/client/domain boundaries.
- [ ] 3.2 Add Python Import Linter contracts for API/application/domain/infrastructure layers.
- [ ] 3.3 Route the new structural checks through `verification-manifest.json`.

## Phase 4 — Executable lifecycle contracts

- [ ] 4.1 Define `review-session` state machine.
- [ ] 4.2 Define `endpoint-lease` state machine.
- [ ] 4.3 Define `stage-binding` state machine.
- [ ] 4.4 Add model-based tests for forbidden shortcuts and evidence-gated transitions.

## Phase 5 — Continuous architecture learning

- [ ] 5.1 Classify recurring `$improve-codebase-architecture` findings.
- [ ] 5.2 Promote recurring findings to invariants, validators, or structural tests.
- [ ] 5.3 Publish architecture quality grade and baseline trend without auto-merging repairs.
