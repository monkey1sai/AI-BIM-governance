# ADR: Deepen Governance Library Workflow

## Status

Accepted on 2026-07-24 for incremental implementation through the linked nightly architecture spec and tracer-bullet tickets.

## Context

The coordinator exposes two browser-facing governance library operations:

- `POST /api/governance-library/rule-runs`;
- `POST /api/governance-library/diffs`.

The browser sends a logical library version reference rather than a governance-host IFC path. The coordinator loads the governance library tree, resolves the reference, shapes a trusted upstream command, and forwards the governance response after masking server paths.

Today this workflow is inline in `createCoordinatorApp`. The composition root therefore owns logical reference resolution, IDS policy, remote tree loading, single-snapshot diff consistency, trusted request shaping, opaque response forwarding, server-path masking, and `400`/`404`/`502` error selection. Adding or changing an adapter can bypass an invariant because there is no operation-level seam that represents the workflow.

The authority boundary remains unchanged:

- `bim-review-coordinator` owns the browser bridge and trusted command construction;
- `governance-service` owns rule-run, diff, issue, federation, and BCF result truth;
- the browser never receives or submits a governance-host IFC path;
- the generic governance proxy remains a separate compatibility adapter.

Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Governance Library Workflow**. It owns the coordinator-side lifecycle for the two library operations:

1. reject an unsafe optional IDS reference before any I/O;
2. load the governance library tree through a narrow port;
3. resolve browser-safe logical version references to governance-host IFC paths;
4. use one tree snapshot for both sides of a diff;
5. construct the exact trusted rule-run or diff request body;
6. post the command through the port;
7. mask supported server paths before returning an opaque upstream reply;
8. classify expected failures as operation outcomes.

The module does not own:

- Zod parsing or Express request/response objects;
- authentication, correlation IDs, retries, caching, persistence, or reconciliation;
- generic `/api/governance/*` proxy behavior;
- issue-snapshot, federation, viewer-log, runtime mutation, frontend, or Kit workflows;
- governance result authority.

### 2. Public surface

Expose two operation-specific asynchronous methods:

```ts
class GovernanceLibraryWorkflow {
  runLibraryRuleRun(command): Promise<GovernanceLibraryOutcome>;
  runLibraryDiff(command): Promise<GovernanceLibraryOutcome>;
}
```

Commands use camelCase domain fields and logical `GovernanceLibraryVersionReference` values. They never accept an Express object or a governance-host path from a browser.

Expected outcomes form a closed discriminated union:

```text
forwarded
invalid_ids
version_not_found
unavailable
```

A forwarded reply carries only upstream status, content type, and path-redacted opaque body text. It is not a generic response/header/configuration bag. The workflow never returns an unredacted upstream body to the route adapter.

Express retains exhaustive mapping to the existing wire contract:

- `invalid_ids` → `400 { error_code: "invalid_ids_path", detail }`;
- `version_not_found` → `404 { error: "library_version_not_found" }`;
- `unavailable` → `502 { error: "governance_unreachable" }`;
- `forwarded` → upstream status, content type, and redacted opaque body text.

### 3. Narrow dependency port

The workflow depends on one operation-specific port with three methods:

```ts
interface GovernanceLibraryPort {
  loadTree(): Promise<LibraryTreeShape>;
  postRuleRun(body): Promise<OpaqueGovernanceReply>;
  postDiff(body): Promise<OpaqueGovernanceReply>;
}
```

The production HTTP adapter resolves `GOVERNANCE_API_BASE` on every method call. It does not capture the environment at import, app startup, or workflow construction time. The workflow itself never reads environment variables.

An in-memory adapter is permitted for deterministic operation tests. Do not add a generic HTTP client framework, repository layer, dependency registry, barrel, or transport-wide abstraction.

### 4. Tree and lookup semantics

`loadTree` preserves the existing three-second timeout and `Accept: application/json` request. Network failure, timeout, non-2xx status, invalid JSON, or a lookup exception is `unavailable`.

A successfully parsed tree that can be inspected but contains no exact `{project_id, model_id, version_name}` match is `version_not_found`. The first cutover preserves current behavior for unusual but valid JSON shapes; it does not silently introduce a new tree-validation contract.

`runLibraryDiff` calls `loadTree` exactly once and resolves both references from that same snapshot.

### 5. IDS policy and command shaping

Rule-run accepts only an optional `.ids` basename, either bare or under `rules/`. Absolute paths, drive-qualified values, traversal, nested arbitrary directories, wrong extensions, and non-string values are rejected before `loadTree` or POST.

Optional upstream fields preserve omission semantics. The workflow does not serialize absent values as `null` or `undefined`:

- rule-run optionally includes `ids_path` and `model_version_id`;
- diff optionally includes `include_geometry`, `base_model_version_id`, and `target_model_version_id`.

### 6. Opaque forwarding and masking

POST replies preserve the upstream status, content type, and body text without JSON parsing or reserialization. Upstream `202`, `400`, `404`, `500`, custom content types, and non-JSON bodies are forwarded rather than converted to coordinator success or failure outcomes.

The only content transformation is the existing supported Windows-drive and allowlisted POSIX absolute-path masking to `[server-path]`. The route adapter never receives the unmasked body.

POST network failure remains `unavailable`. This decision adds no POST timeout, retry, cache, fallback, or circuit breaker.

### 7. Compatibility duplication

The generic governance proxy has private IDS and path-masking policies with different transport semantics, including timeout, binary, and error-body behavior. The first slice does not modify or import from that frozen adapter.

The duplicate policy is deliberate compatibility duplication. Parity tests protect the common supported cases. Any consolidation or broader UNC/POSIX masking hardening requires a separate security and public-contract decision.

### 8. Incremental cutover

Implement the decision as tracer bullets:

1. introduce the module and adapters, prove the workflow seam with unit tests, and migrate the rule-run route end to end;
2. migrate the diff route, prove its single-tree invariant, and remove obsolete inline library helpers;
3. run the full coordinator and browser-wire contract gates before declaring the architecture cutover complete.

During the migration, an operation has exactly one owner. The first ticket may leave the diff operation inline while rule-run delegates to the workflow; it must not run both implementations for one request.

## Considered Options

### Keep both routes inline

Rejected. It has the smallest immediate diff but keeps policy in the composition root and offers no independent operation seam.

### Extract only an Express router

Rejected. It moves lines without hiding policy or improving deletion-test depth.

### Build one generic governance gateway

Rejected. Library forwarding, generic proxy, issue snapshot, and federation have materially different timeout, binary, error, and state semantics. A broad client would either leak configuration or erase contract differences.

### Reuse generic proxy private helpers immediately

Rejected for the first slice. It would modify a frozen compatibility surface and expand regression scope before the library workflow has independent parity evidence.

### Introduce Governance Library Workflow

Accepted. Two domain operations hide a larger set of invariants behind a narrow remote port, pass the deletion test, and permit atomic source rollback.

## Consequences

### Positive

- `createCoordinatorApp` becomes a thinner HTTP composition root.
- IDS-before-I/O, single-tree diff, trusted body shaping, and failure taxonomy become directly testable.
- Production transport can be substituted with an in-memory port without creating a fake Express request.
- The browser and governance-service contracts remain unchanged.

### Negative

- IDS normalization and path masking remain duplicated with the generic proxy until a separate compatibility decision.
- The staged cutover temporarily has one workflow-owned rule-run operation and one inline diff operation.
- Exact opaque forwarding requires tests that compare status, content type, and body text rather than parsed JSON alone.

## Verification

The cutover is accepted only when executable evidence proves:

1. invalid IDS returns the existing `400` body with zero tree or POST calls;
2. logical nested-version resolution and optional-field omission remain exact;
3. rule-run and diff preserve upstream `202`, error statuses, custom content type, and opaque non-JSON body text;
4. supported Windows and POSIX server paths are masked before the route receives a body;
5. tree timeout, network error, non-2xx, bad JSON, and lookup exceptions map to the existing `502` body;
6. a valid tree without the exact triplet maps to the existing `404` body;
7. POST network failure maps to the existing `502` body with no retry;
8. diff loads the tree once per operation;
9. existing governance library route tests and the viewer coordinator-client wire test pass;
10. coordinator typecheck, lint, affected tests, `npm run verify`, `git diff --check`, GitNexus impact, and compare-to-`origin/main` detect-changes gates are recorded.

No frontend route, button, fixture, Kit runtime, deployment, or design-fidelity claim is made by this internal behavior-preserving refactor.

## Rollback

Rollback is a source-level revert of the affected tracer bullet:

- restore the corresponding inline route workflow in `app.ts`;
- remove the now-unused workflow operation, adapter method, and tests;
- rerun the same targeted route and coordinator verification commands.

There is no data migration, persisted state, remote service change, or dual-write to undo. The generic proxy remains untouched, so rollback does not require cross-service coordination.
