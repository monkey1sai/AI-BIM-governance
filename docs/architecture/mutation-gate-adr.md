# ADR: Deepen the Kit Mutation Gate

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Amends [kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md) decision 1: `x-kit-command` gains an optional `context` field list. Runtime Mutation Authority policy ([runtime-mutation-authority-adr.md](runtime-mutation-authority-adr.md)) is unchanged.

Amended on 2026-09-23 while implementing tracer bullet 1 (§4): `M/mutation_gate.py` holds `MutationGate`, `Admitted` and `Refused`. `extension.py` builds one gate over `RuntimeAuthorityClient.from_env()` and passes it to both managers, whose constructors take `mutation_gate` instead of the client. `admit` accepts an optional `precondition`: a local refusal that runs after trace verification and before authorization. The loading manager passes its one-stage-attempt-at-a-time guard there, because a second stage load must still be refused without opening a coordinator authorization for it. `verify_readonly` answers `getChildrenRequest`, `cameraStateRequest` and `loadingStateQuery`; `confirm_stage` replaces the loading manager's four direct client calls; the trace log lines moved into the gate unchanged. `reauthorize` arrives with measurement in bullet 2. Until then the gate exposes the client as `authority` for the measurement runtime, and the StageManager measurement test gives its gate the measurement tests' own authority stand-in. Manager tests run a real gate over a real client whose transport is `tests/runtime_authority_service_fake.py`, an in-memory stand-in for the coordinator's four internal routes; `FakeAuthority` and `UnreachableAuthority` are deleted. Two expectations changed with the real client: a missing trace never reaches the coordinator (only a foreign trace is sent for verification), and `composeStageRequest` is refused by the client itself as harness-only, so no authorization request is sent. Gate refusals already carry `runtime_state: "unchanged"`, so managers dispatch them as they are; only the loading manager's confirmation failures add `runtime_state` themselves. The service fake answers a refused trace verification with the trace echoed, the shape the client was designed for; the coordinator's real refusal carries neither the body `trace_id` nor `X-Trace-Id`, which the client classifies as `authority_unavailable`, so in production a foreign trace is answered retryably instead of being dropped. That gap predates this bullet, is pinned in `tests/test_runtime_command_authority.py`, and waits for an owner decision on which side changes.

Amended on 2026-09-24 while implementing tracer bullet 2 (§4): `MutationGate.reauthorize` asks the authority again without a second trace verification or the precondition and returns `Admitted` with the authorization's trace id. `MeasurementRuntime` takes the gate instead of the client: the first grant of every DataChannel request (start, pick, cancel, clear) goes through `admit`, so measurement now verifies its trace, and the re-grants while that request is served use `reauthorize`. Replies are unchanged, also when the trace is refused. The temporary `authority` property is gone. The trace-verification gap recorded above is closed on the Kit side (owner decision, 2026-09-24): `RuntimeAuthorityClient` accepts an answer that does not echo the trace only as a refusal, so the coordinator's `200 {verified: false}` is a silent refusal instead of a retryable `authority_unavailable`, while a positive answer still needs the echo. The coordinator also answers a failure of its own trace lookup with `verified: false` (`datachannel_trace_authority_unavailable`, the same code as a foreign trace), so such a failure is now dropped like a refused trace; a transport failure or a non-200 answer is still answered retryably. `tests/runtime_authority_service_fake.py` answers a refused verification in the coordinator's shape.

## Context

Paths: `M` = `bim-streaming-server/source/extensions/ezplus.bim_review_stream.messaging/ezplus/bim_review_stream/messaging`.

Kit admits mutating DataChannel commands in three different ways:

- `StageManager._verify_datachannel_trace` and `_authorize_mutator` (`M/stage_management.py:514-550`), used by eleven handlers;
- `LoadingManager._verify_datachannel_trace` (`M/stage_loading.py:346-366`), a near-verbatim copy that differs only in how rejections are dispatched, followed by an in-progress guard and `authorize` (:824-833, :912-920), plus `confirm_stage` on four paths;
- `MeasurementRuntime._grant` (`M/measurement_runtime.py:77-100`), which never verifies the trace with the authority, calls `authorize` on a worker thread once per grant (up to three times per command), reads policy from `decision.data["measurement_context"]`, and reports every denial as `measurementResult` with a generic error and no `retryable` or `detail_code`.

The transport (`RuntimeAuthorityClient`, `M/runtime_authority.py`) is injected into both managers and passed on to the measurement runtime (`stage_management.py:641`). `_command_context` (`runtime_authority.py:446-462`) is a hand-written per-command field list; the generated vocabulary carries no field list (`x-kit-command` keys are limited to `mutates`, `stageLoad`, `harnessOnly`, `results`); the coordinator keeps its own per-command Zod schemas (`runtimeMutationAuthority.ts:276-320`); no test compares them. Manager tests inject hand-written `FakeAuthority` classes whose comments say they mirror the client; the real decision parsing is tested separately with `FakeTransport`, so the two are never composed. Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Interface? | `admit(event_type, payload)` → `Admitted(trace_id, decision)` or `Refused(rejection)`; `reauthorize(event_type, payload)` (authorize only, for measurement re-grants); `verify_readonly(event_type, payload)`; `confirm_stage(payload, outcome)`. The gate owns the authority transport. | `confirm_stage` is stage-load-specific. | One owner of the transport is worth more than purity; managers never hold the client. |
| Does the gate dispatch `commandRejected`? | No. It returns the rejection payload (or none); managers dispatch through their existing paths (`get_eventdispatcher`, `_dispatch_rejection` with `runtime_state`). | Managers still repeat a dispatch line. | Keeps the gate free of Kit's event system and testable in-process. |
| Silent drop of a refused trace? | Preserved: `Refused(rejection=None)`; only `authority_unavailable` is answered. | Dropping hides refusals. | The existing comments state the authenticity rationale; changing it is a contract decision. |
| Two round trips (verify, then authorize) → one? | Not now. Kept for the deepening; recorded as the first follow-up once a cross-service test pins that the coordinator's authorize rejects a foreign trace. | Halves latency on the event thread. | Behaviour-preserving first; the gate makes the later collapse a one-line change. |
| Measurement? | The first grant of a measurement goes through `admit` (gains trace verification); re-grants use `reauthorize`. Replies are unchanged. | Adds one round trip (up to 0.5 s) on the first grant, inside measurement's existing 1.0 s wait; replies still lack `retryable`. | Closing the reach-around is the point; reply fields are an additive schema change, listed as follow-up. |
| Command context single source? | `x-kit-command.context: [fields]` in the schema; the generator emits `KIT_COMMAND_CONTEXT_FIELDS` for the viewer, the coordinator and Kit; `_command_context` reads it; the coordinator adds a parity test between its Zod keys (after the two camelCase mappings) and the generated list. | The generator rejects unknown keys by design. | That is why this is an ADR amendment, not a patch. |
| Tests? | Managers get a real gate over `RuntimeAuthorityClient(transport=FakeTransport)`; the `FakeAuthority` classes are deleted. | Manager tests get verbose. | A small response builder keeps them terse; decision semantics finally run end-to-end in-process. |
| Runtime evidence? | Required: the streaming pytest suites plus one real Kit E2E on canonical Linux 181 for a mutator (camera view) and a measurement start, with DataChannel ACK evidence. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Mutation Gate** (`M/mutation_gate.py`). Every DataChannel command that may change the stage is admitted through it before its payload is acted on: the local denials the authority client already decides (vocabulary membership, harness-only, the envelope fields it needs), DataChannel trace verification, the Runtime Mutation Authority decision and the stage-load rollback on an unanswered authorization. After Kit reports a stage result, stage confirmation goes through the same module. It returns either an admitted command with the authority's data or the exact `commandRejected` payload to answer with. Per-command payload validators stay hand-written in each runtime (Kit Command Vocabulary decision 3).

It does not own: dispatching events, stage state, measurement policy semantics, the trace context binding (`DataChannelTraceContext` stays shared), or coordinator policy.

### 2. Public surface

```python
class MutationGate:
    def __init__(self, authority: RuntimeAuthorityClient): ...
    def admit(self, event_type: str, payload) -> Admitted | Refused: ...
    def reauthorize(self, event_type: str, payload) -> Admitted | Refused: ...
    def verify_readonly(self, event_type: str, payload) -> str | Refused: ...   # trace id
    def confirm_stage(self, payload, outcome: str) -> AuthorityDecision: ...

@dataclass(frozen=True)
class Admitted:
    trace_id: str
    decision: AuthorityDecision

@dataclass(frozen=True)
class Refused:
    decision: AuthorityDecision
    rejection: dict | None      # None = drop silently (refused trace)
```

`Refused.rejection` is built with `command_rejected_payload`; managers add `runtime_state` when they dispatch. Blocking behaviour is unchanged: managers call on the event thread with the client's 0.3–0.5 s timeouts; measurement keeps calling from a worker thread under its 1.0 s `wait_for`, which on the first grant now covers two round trips.

### 3. Vocabulary amendment

`tests/contracts/kit-datachannel-v1.schema.json` `x-kit-command` accepts `context: string[]` (payload property names forwarded as `command_context`). `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs` validates each name against `payload.properties`, emits `KIT_COMMAND_CONTEXT_FIELDS` for the three runtimes it already serves (viewer, coordinator, Kit), and fails on unknown names. `_command_context` becomes a lookup over the generated data. A coordinator test asserts that the key set of each `runtimeCommandContextSchemas` entry (after `toRuntimeCommandContext`) equals the generated list.

Implemented on 2026-09-23 as tracer bullet 3 (§4), independently of bullets 1 and 2. The 13 commands whose context Kit forwarded by hand now carry `context` in the schema (`[]` for the stage loads and clear highlight); `composeStageRequest` and the read-only commands carry none. The generator accepts only names the payload declares itself, in its own `properties` and those of its `allOf`/`oneOf`/`anyOf` branches, without following `$ref`, so an envelope field that a payload reaches only through `$ref` cannot become context; it also refuses duplicates and `context` on a read-only command. `toRuntimeCommandContext` moved from `app.ts` next to `runtimeCommandContextSchemas`, both exported, and `bim-review-coordinator/tests/runtime-command-context-parity.test.ts` checks every schema's key set against the generated list read through those renames, counting only the fields Kit forwards.

### 4. Incremental cutover

1. Gate and both managers (behaviour-preserving; two-step kept); tests switch to a real gate over `FakeTransport`.
2. Measurement through the gate (first grant `admit`, re-grants `reauthorize`); a test for the added trace verification.
3. Schema `context`, generator and parity test; `_command_context` reads generated data.

Follow-ups, not decided here: a single round trip; `retryable` and `detail_code` on measurement replies.

## Considered Options

- Extract only the shared `_verify_datachannel_trace` helper: rejected; measurement still reaches around.
- Put the gate inside `RuntimeAuthorityClient`: rejected; the client is the transport adapter and must stay swappable.
- Generate the coordinator Zod schemas from the field list: rejected; types and refinements would be lost; a parity test is enough.
- Introduce Mutation Gate: accepted.

## Consequences

### Positive

- One admission order; measurement verifies its trace.
- The real decision parsing is exercised by manager tests.
- Command context has one source across three runtimes.

### Negative

- One more loopback call per measurement start.
- The vocabulary schema and generator change.
- The latency win (single round trip) is deferred.

## Verification

1. `cd bim-streaming-server` and, with the repo `.venv`, `pytest tests/test_stage_management_runtime_authority.py tests/test_stage_loading_stage_composition.py tests/test_runtime_command_authority.py tests/test_measurement_runtime.py tests/test_mutation_gate.py -q`; `pytest tests/test_runtime_command_contracts.py -q` at the repo root.
2. `cd web-viewer-sample && npm run generate:kit-command-vocabulary` produces no diff beyond the intended files; the coordinator parity test is green.
3. Real Kit E2E on canonical Linux 181, in a visible Chrome: camera view admitted and refused (invalid lease), measurement start, with DataChannel ACK and `commandRejected` evidence.
4. `git diff --check`.

## Rollback

Source revert per PR; the schema amendment reverts together with its generated files.
