# ADR: Deepen Review Session Opening

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Follows the shape of [runtime-mutation-authority-adr.md](runtime-mutation-authority-adr.md) and [governance-library-workflow-adr.md](governance-library-workflow-adr.md). The Coordinator Browser Contract bodies of the affected routes are unchanged by this decision.

## Context

Three ways of entering a Review Session for a ready model are implemented inline in `createCoordinatorApp` (`bim-review-coordinator/src/app.ts`):

- closed-session recreation, `POST /api/review-sessions/:closedSessionId/recreate` (:2230-2379): Idempotency-Key digest, an in-flight join map (`recreationInFlight`, :844), receipt replay, deterministic-id replay, a rebuildability gate (`rebuildabilityForSession`, :1913-1966), derived-binding selection, `store.create`, and a late 201 → 200 rewrite for joined requests;
- ready-model open or create, `POST /api/conversion/records/:readyModelId/review-session` (:3529-3634, helpers :3477-3528): three intents (`legacy`, `create_new`, `open_existing`), a second in-flight map (`readySessionRequests`, :3481), resolver failure classified as 502 or 409, an artifact-health probe, a ledger race re-read, `sessionMatchesReadyBundle`, `createOrGetReviewRequest`, and the legacy branch through `autoCreateOrActivateSession` (:4237-4353);
- automatic open at conversion terminal: `onConversionTerminalImpl` (:4357-4425) → `autoCreateOrActivateSession`.

The review-request carrier corruption predicate is written out four times, with two spellings of the result (`{ detail }` at :2252-2261 and :2870-2876, `{ error_code }` at :3573-3579, and a variant inside `sessionMatchesReadyBundle` :3487-3492) and one difference in the rule: the recreate copy also refuses a carrier outside the request namespace that still carries a `review_request_id` (:2259), which the lease-claim and open-existing copies do not check. `"Review session not found."` appears 23 times in `app.ts`. Recreation lineage events are appended by `ensureRecreationEvents` (:1968-2014) from four call sites (:2271, :2297, :2351, :4338).

Tests reach these paths only through supertest: `tests/sessions.test.ts` (7 recreate cases among 71), `tests/ready-model-session.test.ts` (39 of 40) and `tests/host-native-conversion-ingest.test.ts` (auto-create through the terminal observer).

Two contract gaps surfaced while reading and are recorded here, not fixed: the IFC-ready open route can answer 422 (undeclared) and never the declared 502; recreate turns a receipt-lineage mismatch into an undeclared 500.

Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Which entry paths belong to the module? | Recreation, ready-model open/create/legacy, and the automatic open at conversion terminal. Not `POST /api/review-sessions` (caller-supplied bindings, federated-set branch) and not the IFC-ready route (it already runs through the pipeline's terminal observer). | Explicit create shares `store.create`, event append and Kit allocation. | Its input shape and its governance review-room dependency differ; it joins as a fourth operation once the shared internals exist. |
| One `open(union)` or one method per path? | One method per path, each with its own closed outcome. | A single method is smaller. | Wire bodies differ per route; per-path unions keep the route switches exhaustive; the implementation is shared. |
| Where does the corruption predicate live? | `sessionStore.ts`, next to `isCanonicalReadyReviewSourceCarrier`, as one exported predicate used by the module and by the lease-claim route. It implements the stricter recreate rule. | Policy in a store file; lease claim and open-existing become stricter. | It is a record-integrity invariant of the session carrier, which the store already owns. No writer produces a non-namespace carrier with a `review_request_id` (`store.create` from explicit input sets no carrier fields; `createOrGetReviewRequest` always uses the request namespace; auto-create sets `review_request_id: undefined`), so the stricter rule refuses nothing that exists; a test enumerating the three writers keeps it that way. |
| In-flight joins? | One internal join table keyed by operation key; both maps fold in; the joined-replay rewrites (`idempotent_replay`, `session_replay`) become part of the outcome. | — | — |
| Ports? | Two remote: artifact health (`probeArtifactHealth` behind a port) and conversion result (`fetchConversionResult`). In-process: `SessionStore`, `EventLog`, `ConversionLedger`. Kit allocation stays an internal pure function over config. | `rebuildabilityForSession` is also used by the closed-session list. | The module exposes `rebuildability(session)` as a read projection for that route. |
| Wire bodies? | Preserved exactly per route (`{ detail }` for recreate, `{ error_code }` for ready-model). | Unification is the visible win. | Unifying is a Coordinator Browser Contract change with browser impact; separate decision. |
| The contract gaps found? | Recorded in Consequences; not fixed here. | They are bugs. | Fixing them changes declared responses; the deepening stays behaviour-preserving. |
| Tests? | Interface tests with in-memory ports for every recreate, ready-model and terminal policy case; the supertest suites keep one wire case per outcome. | The suites are large and mixed. | Only the policy cases move; setup-only uses stay. |
| Cutover order? | Recreate first (self-contained), then ready-model and terminal open, then deletion of inline helpers. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Review Session Opening** (`src/services/reviewSessionOpening/`). For the three paths it owns: request identity and idempotent replay (Idempotency-Key digests, Recreation Receipts, deterministic ids, review-request scope digests), in-flight joining, the carrier-integrity check, source validation against the current ready bundle, the rebuildability gate, the artifact-health check, binding construction from server-owned artifacts, Kit allocation and the resulting status (`created` or `active`), and the lineage events (`sessionCreated`, `sessionActive`, `sessionRecreated`). On these three paths it is the only writer of creation lineage events; the explicit `POST /api/review-sessions` route (:2162, :2168) and lease admission (:1872) keep their own appends until they join.

It does not own: closing (`closeReviewSessionInternal`), viewer leases, stream config, IFC-ready job records or viewer links (kept in the terminal observer), explicit caller-driven creation, or the wire shapes.

### 2. Public surface

```ts
class ReviewSessionOpening {
  recreate(command: { closedSessionId: string; idempotencyKey: string }): Promise<RecreateOutcome>;
  //   created | replayed | not_found | not_closed | carrier_corrupt | not_rebuildable (rebuildability) | no_ready_binding
  openForReadyModel(command: { readyModelId: string; intent: ReadyReviewIntent }): Promise<ReadyModelOutcome>;
  //   opened (session, replay) | ready_model_not_found | resolver (reason) | ready_artifacts_unavailable
  //   | ready_model_changed | review_session_not_found | carrier_corrupt | source_mismatch | not_mutable
  //   | idempotency_conflict | session_closing | no_usdc_ref | queued_for_instance
  openForConversionTerminal(command: TerminalOpenCommand): Promise<TerminalOpenOutcome>;
  //   opened (session, replay) | no_usdc_ref | queued_for_instance
  rebuildability(session: ReviewSession): Promise<SessionRebuildability>;
}
```

Outcome names map one-to-one onto today's error codes and detail strings; the route adapters own that mapping and remain exhaustive.

### 3. Ports

```ts
interface ArtifactHealthPort { probe(input: ArtifactHealthProbeInput): Promise<ArtifactHealthSnapshot> }   // production: probeArtifactHealth
interface ConversionResultPort { fetch(conversionJobId: string): Promise<...> }                               // shared with CFD Run Workflow's adapter
```

plus `SessionStore`, `EventLog`, `ConversionLedger` and an `OpeningPolicyConfig` value (tenant id, conversion origins, edge data root). Production adapters wrap the existing functions; in-memory adapters live under `tests/helpers/`.

### 4. Shared predicate

`sessionStore.ts` exports `reviewRequestCarrierIntegrity(session): "canonical" | "corrupt"`, implementing the recreate rule once: the carrier is canonical; a request-namespace id matches its scope digest; a carrier outside the request namespace carries no `review_request_id`. The module, `sessionMatchesReadyBundle` (moved inside the module) and the viewer-lease claim route call it.

### 5. Incremental cutover

1. Recreate: module and tests; the route delegates; `recreationInFlight`, `recreationReadySourceMatches` and `ensureRecreationEvents` move inside.
2. Ready-model and terminal open: `readySessionRequests`, the ready helpers and `autoCreateOrActivateSession` move inside; `onConversionTerminalImpl` calls `openForConversionTerminal`.
3. Delete the inline helpers; lease claim switches to the shared predicate; slim the supertest suites.

## Considered Options

- Keep inline and extract only shared helpers: rejected; helpers do not own the in-flight and replay semantics, which is where the copies diverge.
- Fold explicit `POST /api/review-sessions` in now: rejected for this decision (different dependencies); planned as the next operation.
- Unify error bodies at the same time: rejected; contract change.
- Introduce Review Session Opening: accepted.

## Consequences

### Positive

- One carrier-integrity rule and one in-flight table.
- `app.ts` loses about 500 lines of policy; the three paths are testable without HTTP.
- Lineage-event parity is enforced in one place.

### Negative

- Two contract gaps stay open (see Context).
- Recreate and ready-model keep different error-body spellings until a contract decision.
- The module carries a config value object.

## Verification

1. `cd bim-review-coordinator && npx vitest run tests/review-session-opening.test.ts tests/sessions.test.ts tests/ready-model-session.test.ts tests/host-native-conversion-ingest.test.ts`, including the test that enumerates the three session writers against the shared predicate.
2. `npm run verify`; `tests/browser-contract-drift.test.ts` and `tests/browser-contract-response-validation.test.ts` unchanged and green.
3. Browser E2E on the console: open a ready model (`create_new`, `open_existing`, legacy) and recreate a closed session against the real coordinator; request/response pairs recorded.
4. `git diff --check`.

## Rollback

Source revert per PR. Receipts and sessions keep their persisted format.
