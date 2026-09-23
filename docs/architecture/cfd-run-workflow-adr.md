# ADR: Deepen CFD Run Workflow

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Follows the shape of [governance-library-workflow-adr.md](governance-library-workflow-adr.md). The coordinator ↔ streaming CFD job service contract (`docs/plans/building-energy-cfd-p2-contract.md` §3.1) and the browser-facing routes (§3.2, Coordinator Browser Contract) are unchanged.

## Context

`bim-review-coordinator/src/routes/cfdRunRoutes.ts` (590 lines) holds the coordinator-side CFD run policy inside nine Express handlers: binding a run to the exact `model.usdc` sha and the 409 `source_not_ready` / `source_mismatch` selection (:133-197); a regex over the streaming client's error text to tell 404 from other failures (:158); a ledger upsert on 202 and on the 200 idempotent replay, with the browser origin recorded only on 202 (:188-191); list and detail with ledger fallback and `stale`, and a list that serves the ledger with `enabled: false` when CFD is disabled (:200-239); public URL rewriting (:110-122); the finding workflow (:317-432) with its severity rule, ledger idempotency, a raw `fetch` lookup and a raw `fetch` `POST /api/issues` to governance, and an in-closure lock map (:287-300); overlay registration with a hand-written lifecycle check (:450-453); overlay removal with neither an `enabled` gate nor a check of the store result (:526-538). Findings and overlay registration forward an upstream non-200 reply verbatim (:335, :462).

`CfdRunLedger` (`src/services/cfdRunLedger.ts`, 187 lines) is a file-backed projection with six public methods and no workflow policy. `CfdRunClient` (94 lines) is six HTTP one-liners. `app.ts:5549-5569` constructs both inline inside the options literal, captures `GOVERNANCE_API_BASE` once at wiring time (contrary to the governance-library decision to resolve it per call) and keeps no handle to either.

Apart from one unit test of `derivePublicCfdArtifactsUrl`, the test surface is HTTP: `tests/cfd-run-routes.test.ts` (20 tests) builds the whole coordinator app plus two in-process `node:http` stubs. No test references the ledger, the client or `registerCfdRunRoutes`; the client's `fetchImpl` seam is unused.

The authority boundary is unchanged: the streaming host owns run execution and results; governance-service owns issues; the coordinator owns binding, projection, finding-to-issue and overlay registration. Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Which operations belong to the module? | All nine: create, list, detail, result, exclusions, cancel, evaluate findings, bind overlay, unbind overlay. | The four reads are near pass-throughs. | Each read writes the ledger or rewrites URLs; leaving them in routes keeps two owners of the ledger. |
| Outcome shape? | Per-operation closed unions. Upstream replies are `forwarded { status, body }` with publicized URLs; upstream 401/403 become `unavailable`. | The governance-library workflow forwards opaque text. | CFD routes already re-serialize JSON and must rewrite URLs; opaque text would move the rewrite back into the route. |
| Ports? | `CfdRunClient` (existing HTTP class plus an in-memory test adapter), `ConversionResultPort` (typed found / not_found / unavailable), `GovernanceIssuePort` (findAnnotation, createIssue; HTTP adapter resolves `GOVERNANCE_API_BASE` per call), `SessionStore` in-process. The ledger is injected and never exposed to routes. | Four dependencies. | Three are remote seams with two adapters each; the store is in-process. |
| Where does the 404 regex go? | Into the `ConversionResultPort` HTTP adapter; the workflow sees a typed result. | Still string matching somewhere. | The adapter is the only place allowed to know the client's message format; a typed client error is a separate follow-up. |
| Overlay lifecycle rule? | `isSessionMutable` (identical to today's check with the five-value status union). DELETE keeps working when CFD is disabled (cleanup) and keeps answering `removed`; a null store result is logged, not surfaced. | DELETE gains no mutability gate. | Behaviour-preserving first; a gate is a product decision recorded as open. |
| The `enabled` switch? | Routes answer 503 when disabled, except list: `listRuns` takes `enabled` and serves the ledger with `enabled: false` (today's behaviour, asserted by `cfd-run-routes.test.ts:297-299`). | The switch leaks into the module. | The ledger lives inside the module; the route cannot serve it otherwise. |
| Upstream non-200 on findings and overlay? | Forwarded verbatim as today: both outcome unions carry `forwarded`. | — | — |
| Finding lock and severity? | Inside the module. `cfdFindingIssuePayload` stays a pure exported function. | — | — |
| Tests? | New tests at the workflow interface with in-memory adapters cover every policy case; the HTTP suite shrinks to wire mapping. Replace, don't layer. | Losing end-to-end coverage. | The HTTP suite keeps one case per outcome; policy moves to the cheaper surface. |
| Cutover order? | Findings and overlays first (most policy), then create, reads and cancel. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **CFD Run Workflow** (`src/services/cfdRunWorkflow/`). It owns: source binding and mismatch detection; forwarding of create, cancel and read replies with the ledger rules (upsert on 202 and on the 200 replay for create, with the browser origin recorded only on 202; upsert on reads; ledger fallback with `stale`; the disabled list served from the ledger); public artifact URL rewriting; the finding workflow (direction filter, threshold, severity `high` when `uMax > threshold × 1.5`, ledger idempotency, per-run serialization, governance lookup before create, ledger record); overlay registration (ready-direction check, artifact id verbatim from upstream, idempotent replay by artifact id, model match against the session's primary binding, binding construction, store-invariant refusal as `session_not_overlayable`) and overlay removal.

It does not own: Zod parsing, Express objects, authentication or the operator guard, the `enabled` switch beyond `listRuns` (routes answer 503), run execution, governance issue truth, or Kit loading of overlays.

### 2. Public surface

```ts
class CfdRunWorkflow {
  constructor(deps: {
    client: CfdRunClient; conversionResults: ConversionResultPort; governanceIssues: GovernanceIssuePort;
    store: SessionStore; ledger: CfdRunLedger; publicCfdArtifactsUrl: string;
  });
  createRun(command): Promise<CreateRunOutcome>;
  //   forwarded | source_not_ready | source_mismatch | conversion_not_found | unavailable
  listRuns(query, options: { enabled: boolean }): Promise<ListOutcome>;   // records (+ stale, enabled)
  getRun(runId): Promise<ReadOutcome>;                         // forwarded | run_not_found | stale_record | unavailable
  getRunResult(runId): Promise<ReadOutcome>;
  getRunExclusions(runId): Promise<ReadOutcome>;
  cancelRun(runId, principal): Promise<ReadOutcome>;
  evaluateFindings(command): Promise<FindingsOutcome>;
  //   evaluated { created, findings } | forwarded | run_not_ready | run_not_found | governance_unavailable (partial) | unavailable
  bindOverlay(command): Promise<OverlayOutcome>;
  //   bound | replayed | forwarded | session_not_found | session_not_active | direction_not_ready
  //   | session_without_model | model_mismatch | session_not_overlayable | unavailable
  unbindOverlay(sessionId, bindingId): Promise<UnbindOutcome>; // removed | binding_not_found | session_not_found
}
```

Commands use camelCase domain fields plus the principal and trace id the route resolved. Routes keep an exhaustive mapping to today's `error_code` values and status codes. No wire body changes.

### 3. Ports

```ts
interface ConversionResultPort {
  fetch(conversionJobId: string): Promise<
    { kind: "found"; result: ConversionResult } | { kind: "not_found" } | { kind: "unavailable"; detail: string }>;
}
interface GovernanceIssuePort {
  findAnnotation(query: { title: string; usdPrimPath: string; modelVersionId: string | null }): Promise<{ id: string; kind: string } | null>;
  createIssue(payload: CfdFindingIssuePayload): Promise<{ id: string; kind: string }>;
}
```

Production adapters: `CfdRunClient` (unchanged); a wrapper over `StreamingConversionClient.fetchConversionResult` that classifies its thrown error; an HTTP `GovernanceIssueHttpAdapter` that resolves `GOVERNANCE_API_BASE` on every call with the existing 5 s timeout. In-memory adapters live under `tests/helpers/`. No generic HTTP framework, repository layer or registry.

### 4. Wiring

`app.ts` constructs the client, the ledger and the workflow, then calls `registerCfdRunRoutes(app, { workflow, enabled, rejectIfUnauthorized, authenticatePrincipal })`. `governanceApiBase` leaves the route options. The workflow is exposed on `CoordinatorApp` for tests and disposal parity.

### 5. Incremental cutover

1. Module, in-memory adapters and interface tests; migrate the findings route and both overlay routes.
2. Migrate create, list, detail, result, exclusions and cancel; delete the route-level helpers, the lock map and the raw `fetch` calls; slim the HTTP suite to wire mapping.

## Considered Options

- Keep routes inline and add tests: rejected; tests would still need the whole app and two servers.
- Extract only a router module: rejected; it moves lines and hides nothing.
- One generic governance client shared with issue snapshot and the proxy: rejected for the reasons given in the governance-library decision (different timeout, body and error semantics).
- Introduce CFD Run Workflow: accepted.

## Consequences

### Positive

- `cfdRunRoutes.ts` becomes parse → one call → exhaustive switch.
- Policy tests run without servers; the ledger becomes an implementation detail.
- Governance base resolution matches the governance-library rule.

### Negative

- Two more port interfaces and their fakes.
- DELETE's missing `enabled` and mutability gates stay as they are until a product decision.
- The finding lock stays in-memory per process (unchanged).

## Verification

1. `cd bim-review-coordinator && npx vitest run tests/cfd-run-workflow.test.ts tests/cfd-run-routes.test.ts`; every current HTTP policy case has an interface counterpart before its HTTP version is removed.
2. `npm run verify` in `bim-review-coordinator`; `tests/browser-contract-drift.test.ts` unchanged and green.
3. Browser E2E on the console: WindEnvironmentPanel create run → findings → overlay apply against the real coordinator, once per cutover PR, with request/response pairs recorded.
4. `git diff --check`.

## Rollback

Source revert per PR. The ledger file format is untouched, so no data migration is involved.
