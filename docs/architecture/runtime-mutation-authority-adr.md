# ADR: Deepen Runtime Mutation Authority

## Status

Accepted and implemented on 2026-07-23 by the atomic cutover tracked in issue #385.

Tracking spec: [GitHub issue #385](https://github.com/monkey1sai/AI-BIM-governance/issues/385).

## Context

The coordinator currently spreads runtime mutation policy across the stage-binding preauthorization route, runtime-command authorization route, pre-mutation rollback route, confirmation route, lease-status projection, `ViewerLeaseStore`, and `StageBindingAuthorityStore`.

This distribution makes `app.ts` responsible for session lifecycle checks, mutator classification, command-context validation, viewer lease inspection, stage transaction matching, event ordering, and wire mapping. The policy is therefore difficult to test through one interface, and a new adapter could bypass a required check or state transition.

The governing service boundary remains unchanged:

- `bim-review-coordinator` owns session-scoped allow/deny policy and the confirmed stage-binding shadow.
- `bim-streaming-server` owns actual Kit mutation, observed stage state, and GPU/runtime truth.
- Browser-side checks are usability guards, not the security boundary.

Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Runtime Mutation Authority**. It owns the complete coordinator-side mutation policy lifecycle:

1. browser stage-binding preauthorization;
2. Kit runtime-command authorization;
3. failure of a stage binding before mutation begins;
4. stage-binding confirmation after Kit reports the outcome;
5. the principal-scoped stage-binding summary projection.

The module does not own:

- viewer lease claim, heartbeat, release, or expiry workflows;
- actual Kit/OpenUSD mutation;
- user or internal-API authentication;
- persistence, distributed locking, reconciliation, or a new retry protocol.

`ViewerLeaseStore` remains an independent collaborator behind a narrow inspection port. The state responsibilities formerly held by `StageBindingAuthorityStore` move into private `stageBindingState.ts`; the old public class and seam are removed.

### 2. Public surface

Export one concrete `RuntimeMutationAuthority` class with six synchronous operations:

```ts
class RuntimeMutationAuthority {
  preauthorizeStageBinding(command): PreauthorizationOutcome;
  authorizeRuntimeCommand(command): AuthorizationOutcome;
  failStageBindingBeforeMutation(command): PreMutationFailureOutcome;
  confirmStageBinding(command): ConfirmationOutcome;
  getStageBindingSummary(query): StageBindingSummary;
  getActiveStageBinding(query): ActiveStageBindingSnapshot | null;
}
```

`getActiveStageBinding` is a principal-scoped, current-active-only read for
coordinator-local consumers that need the confirmed lease, source client, and
canonical composition. It returns a defensive snapshot, not a generic
transaction lookup or a state mutation surface.

The public surface must not expose:

- raw transaction lookup;
- a generic `execute` or `transition` method;
- callbacks;
- private state variants;
- HTTP request or response DTOs;
- a second authority interface, abstract base class, registry, or factory framework.

Commands and outcomes use camelCase domain fields. Express adapters map them to and from the existing snake_case wire contract.

### 3. Module locality

Use a dedicated two-file module:

```text
bim-review-coordinator/src/services/runtimeMutationAuthority/
├── runtimeMutationAuthority.ts  # only public entry
└── stageBindingState.ts         # private state implementation
```

`runtimeMutationAuthority.ts` contains the public class, command and outcome types, dependency-port types, semantic policy, and orchestration. `stageBindingState.ts` contains transaction state, TTL and capacity enforcement, eviction, and exact-attempt matching.

Do not add a barrel, standalone `types.ts`, generic repository layer, or state-machine framework.

### 4. Narrow dependency ports

The authority depends only on operation-specific ports for:

- reading the session mutation context and authoritative artifact bindings;
- inspecting primary and runtime viewer-lease authority;
- appending the `stageBindingApplied` event;
- obtaining time and generating IDs.

Do not inject the full `SessionStore`, `ViewerLeaseStore`, or `EventLog`. The composition root supplies thin object or closure adapters over the existing implementations.

All ports and authority operations remain synchronous. This preserves process-local atomicity within one Node event-loop turn.

### 5. Preauthorization and semantic validation

`preauthorizeStageBinding` accepts the authenticated principal, session ID, source client, opaque lease credential, and syntactically valid browser artifact selections.

The authority resolves the authoritative `StageComposition` from session artifact bindings. It owns all semantic checks, including:

- session existence and mutable lifecycle;
- unique artifact IDs and load order;
- exactly one primary artifact;
- artifact membership, readiness, and authoritative USDC URL resolution;
- primary lease ownership and principal matching;
- mutator catalog membership;
- harness-only denial;
- command-context validity;
- runtime lease authority;
- stage transaction identity and legal phase.

Except for the compatibility-only preflight described under HTTP adapter scope, route adapters retain only syntactic schema validation and caller authentication.

### 6. Transaction and attempt model

A **Stage Binding Transaction** is created by browser preauthorization for one resolved stage composition. Its private state uses a discriminated union:

- `PendingTransaction`;
- `ExecutingTransaction`;
- `ActiveTransaction`;
- `FailedTransaction`;
- `SupersededTransaction`.

Each variant contains only fields legal for that phase. Existing external status values and projections remain unchanged.

A **Stage Binding Attempt** is the immutable exact identity of one proposed Kit stage-load execution. Its base equality includes authorization and revision IDs, session, resolved lease ID, source client, and the complete ordered stage composition. After claim, request ID and event type are also required.

Rollback and confirmation replay require exact equality. No relaxed or additional idempotency key is introduced.

### 7. State and retention model

Stage-binding state remains synchronous and process-local. Preserve current TTLs, capacity limits, eviction, active/last-good projection, supersession, and idempotent replay behavior.

Do not introduce a repository interface, database, distributed lock, or durable state in this change. A multi-instance authority requires a separate design because it changes transaction and failure semantics.

### 8. Failure model and event ordering

Expected policy outcomes use operation-specific discriminated unions. Examples include session lifecycle denial, invalid lease, unsupported command, invalid context, transaction mismatch, and capacity exhaustion.

Unexpected dependency failures or broken invariants throw exceptions and must not commit state. The Express adapter preserves the existing 5xx behavior for those failures.

For successful stage confirmation, the authority owns this ordering invariant:

1. validate the exact attempt and current lease/principal;
2. append `stageBindingApplied` through the event-sink port;
3. commit `executing → active` and update active/last-good state;
4. return success.

If event append fails, the transaction stays `executing`, active/last-good remains unchanged, and the exact confirmation can be retried. The Kit-side state remains classified as `changed_unconfirmed`.

`failStageBindingBeforeMutation` is deliberately not a general rollback or compensation API. It may fail a matching `pending` transaction, a matching `executing` attempt whose authorization response was lost, or accept an exact idempotent replay of the same `authorization_unavailable` failure. It never reverses a Kit mutation.

The existing HTTP path containing `stage-binding-authorization-rollbacks` remains unchanged for compatibility.

### 9. Credential non-retention

The opaque viewer lease token may exist only during a command call and may only be passed to the lease-inspection port. It must never be stored in a transaction or Stage Binding Attempt, appended to an event, included in a result, or added to diagnostic context.

State and equality retain only the resolved `lease_id`, principal, and source client.

### 10. Mutator catalog ownership

The coordinator's closed mutator catalog, stage-load classifier, harness-only rule, and command-context validators are internal Runtime Mutation Authority policy. They are not runtime configuration and are not injected through a generic validator.

The Python streaming client keeps its local mirror for fail-fast and defense-in-depth behavior. A language-neutral, tests-only fixture at `tests/contracts/runtime-mutation-authority-v1.json` records the stable event vocabulary and rejection reasons. TypeScript and Python tests verify their runtime constants and behavior against the fixture; production code does not load it, and no cross-language code generation is added.

### 11. HTTP adapter scope

Keep route paths, Zod wire schemas, user/internal authentication, correlation or rejection ID creation, and exhaustive outcome-to-response mapping in `app.ts` for the first slice.

The browser stage-binding preauthorization route is the sole compatibility exception. It must preserve the existing session-existence and mutable-lifecycle preflight before request-body parsing so requests with multiple simultaneous faults retain their current error precedence. Runtime Mutation Authority repeats those checks independently; the route preflight is not trusted as authorization and is not the policy source of truth.

Do not create a new Express router layer in this change. The affected handlers should become thin adapters, but route extraction is a separate optional change.

All existing routes, status codes, request and response schemas, `detail_code` values, transaction statuses, and Python client mappings are frozen.

### 12. Atomic migration

Use one coordinator-local runtime cutover:

1. add Runtime Mutation Authority and black-box tests;
2. switch summary, preauthorization, authorization, pre-mutation failure, and confirmation callers to the same authority instance;
3. remove all direct store usages;
4. delete `src/services/stageBindingAuthorityStore.ts` and its direct test seam.

Do not deploy a version with two state owners. Do not add dual writes, a feature flag, a compatibility re-export, or a deprecated wrapper.

## Alternatives rejected

### Keep policy in Express handlers

Rejected because state and authorization invariants remain distributed, route tests stay the only complete test surface, and new adapters can omit checks.

### Wrap only `StageBindingAuthorityStore`

Rejected as a shallow module. Session, artifact, lease, catalog, command-context, and event-ordering policy would still live outside it.

### One generic transition method

Rejected because the four phases accept different inputs and have asymmetric replay and failure semantics. A tagged generic switch would expose the state protocol rather than hide it.

### Absorb viewer lease lifecycle or Kit execution

Rejected because lease lifecycle and actual GPU mutation are separate responsibilities. Combining them would create a broad session/runtime module and violate the coordinator-policy versus Kit-execution seam.

### Add persistence or an asynchronous repository port

Rejected because there is only one process-local implementation and no approved multi-instance semantics. An unused port would increase interface area without leverage.

### Share runtime code across TypeScript and Python

Rejected because it creates deployment coupling. A tests-only contract fixture detects vocabulary drift without becoming a runtime dependency.

## Consequences

### Benefits

- Runtime mutation policy gains one test surface and one state owner.
- Express handlers become thin transport adapters.
- Illegal transaction field combinations become unrepresentable internally.
- Raw state mutation and lookup can no longer be used by routes.
- Response-loss, idempotency, credential handling, and event ordering become explicit module invariants.
- The coordinator/streaming ownership seam remains unchanged.

### Costs and risks

- The atomic cutover touches several sections of the large `app.ts` composition root.
- A new private state representation can introduce projection regressions if black-box parity tests are incomplete.
- TypeScript and Python still maintain separate runtime catalogs; tests detect drift but do not eliminate duplication.
- Process-local state remains unsuitable for multi-instance coordinator deployment.

## Non-goals

- No public API, status, error, TTL, capacity, or retry-policy change.
- No browser UX or Kit mutation change.
- No reconciliation protocol for `changed_unconfirmed` runtime state.
- No router extraction, persistence, distributed lock, event bus, generic state-machine library, or new production dependency.
- No cleanup or refactor outside the runtime mutation authority caller set.

## Test boundary and acceptance gates

The Runtime Mutation Authority public interface is the primary unit-test surface. Migrate transition, TTL, capacity, eviction, exact-match, and replay cases from direct store tests to black-box authority tests using fake dependency ports and deterministic clock/ID generation. Do not export private state solely for tests.

Preserve HTTP integration tests as wire-contract regression coverage and Python fake-transport tests as streaming-client coverage.

Required gates:

```powershell
cd bim-review-coordinator
npm test -- tests/services/runtimeMutationAuthority.test.ts tests/runtime-command-authority.test.ts
npm test
npm run build

cd ..\bim-streaming-server
python -m pytest tests/test_runtime_command_authority.py tests/test_stage_management_runtime_authority.py -q
```

Both languages must also pass the tests-only contract-fixture parity checks. Before commit, run the repo-required GitNexus change detection and disclose any stale or unavailable index rather than treating it as a pass.

Browser, visual, and Kit runtime E2E are not required for this behavior-preserving slice because it changes neither frontend behavior nor the Kit mutation implementation. Any change to an existing HTTP contract, transaction projection, detail code, or Python client behavior is a regression.

## Rollback

Rollback is a source-level revert of the complete atomic cutover: restore the previous `StageBindingAuthorityStore`, its tests, and all six direct caller paths together. Do not partially revert only some routes, because that would create split state ownership.
