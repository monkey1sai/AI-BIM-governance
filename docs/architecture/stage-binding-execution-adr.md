# ADR: Deepen Stage Binding Execution

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Amends [viewer-command-channel-adr.md](viewer-command-channel-adr.md) decision 2, which keeps stage load in `Window.tsx`: stage load moves into its own module, still outside the Channel as that decision's rejected alternatives require; the Channel's Status records the amendment. Builds on [runtime-mutation-authority-adr.md](runtime-mutation-authority-adr.md); coordinator policy is unchanged. Kit behaviour and the `vg01` wire format are unchanged.

## Context

The viewer's side of a stage load (its part of a Stage Binding Attempt when a Stage Binding Transaction backs it, and the whole of it in harness or asset-open mode) lives in at least nine non-adjacent regions of `web-viewer-sample/src/Window.tsx` (5986 lines; a class component with about 53 state fields, 70 instance fields and 140 private methods): attempt types and timeouts (:385-441), fields (:639-703), parent apply and result report (:904-952), the mutator gate (:1494), the attempt state machine (24 methods, :1959-2436), preauthorization with deadline and cancellation barrier (:2937-3082), `_applyBinding` (:3366-3502), the asset-open path that also begins attempts (:4082-4181), proof resync (:4523-4616), and the Kit event chain (`openedStageResult` :4828, `loadArtifactGroupResult` :5007, `bindingApplied` :5355).

Nothing exposes an interface. Tests instantiate `App` unmounted and call privates: `console/windowParentMessage.dom.test.tsx` (7370 lines) has 117 `_beginStageAttempt`, 37 `_applyBinding`, 42 `_preauthorizeStageBinding` and 104 `activeStageAttempt` references. Window already builds collaborators in a ports style: `NativeStageDispatchQueue` (:657), `RuntimeCommandTracker` (:688), `IssueViewExchange` (:712) and the Channel's `kitSide` (:852). Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| What goes inside? | The attempt lifecycle (begin, supersede, terminalize, invalidate, complete, fail), the Stage Proof (confirmed revision, proof block, resync), preauthorization with its deadline and cancellation barrier, timeouts, the visible-frame promotion rule, the parent-facing result report, and the mapping of Kit results and refusals to attempt transitions. `NativeStageDispatchQueue` moves in. | Visible-frame promotion is a stream concern. | It changes attempt status; the stream feeds it one call (`observeVisibleFrame`). |
| What stays in Window? | The send pipeline (lease stamping, mutator gate, tracker registration), stream lifecycle generation, asset selection UI, harness and spectator mode, mapping auto-load and `_getChildren` after completion, A4 handoff (reads a snapshot), rendering. | — | Same line as the Channel decision: the module uses the send pipeline; it does not own it. |
| Placement? | `web-viewer-sample/src/stageBinding/` with `createStageBindingExecution(ports)`, a sibling of `viewerCommandChannel/`. | Put it in the Channel. | Rejected by the Channel decision; a transaction has a different lifecycle from a request/reply. |
| Ten ports: still deep? | Yes. Today's surface is 24 methods plus 20 fields plus 8 state fields poked directly; the new surface is ten methods in and ten narrow ports out. | Wide port list. | Each port is one Window capability the module needs; none is per-command. |
| State projection? | The module holds its state and emits `StageBindingState` snapshots; Window copies them into `AppState` in one place. | Duplicated state. | One copy is the source; the other is a render projection. |
| Tests? | Table-driven module tests with fake ports. Every stage regression in the Window suites is ported one-for-one before its Window version is deleted, and the mapping is listed in the PR. | The 7370-line file encodes hard-won regressions. | The mapping list is the safeguard: nothing is deleted before it exists at the new surface. |
| Runtime evidence? | Required: real Kit E2E on canonical Linux 181, with stage binding apply from A1 and a CFD overlay apply, with first frame, `stage_loaded active`, DataChannel ACK and `bindingApplied`; the unconfirmed/resync path through the harness. | Cost. | `AGENTS.md` requires it for user-facing Kit workflows. |
| Cutover order? | Machine and preauthorization first (Window delegates, state projected), then parent apply, Kit event routing and resync, then deletion of privates and test rewrites. | — | — |

## Decision

### 1. Responsibility boundary

Introduce one deep module named **Stage Binding Execution** (`src/stageBinding/`). It owns one stage load on the viewer side, from a binding selection or asset choice to one terminal result, whether or not a Stage Binding Transaction backs it: resolving the selection against the session's artifact bindings; preauthorization through Runtime Mutation Authority with the 45 s deadline and the 5 s cancellation barrier; beginning and superseding attempts; dispatching the stage-load command through the send port; the stage-load timeout; matching `openedStageResult`, `loadArtifactGroupResult`, `bindingApplied` and `commandRejected` to the attempt; the Stage Proof (confirmed revision, `changed_unconfirmed` block, authenticated resync against coordinator revisions); and exactly one `stage_binding_result` per parent request.

It does not own: lease stamping, mutator blocking, tracker registration, the stream, harness or spectator policy, mapping load, or rendering.

### 2. Public surface

```ts
interface StageBindingExecution {
  applyFromParent(selection: StageBindingSelection[], clientRequestId: string | null): void;
  apply(selection: StageArtifactBinding[], revisionId: string): void;              // UI path
  beginForAsset(targetUrl: string, bindings: StageArtifactBinding[]): Promise<void>; // asset-open path
  receiveKitEvent(eventType: string, payload: Record<string, unknown>): boolean;
  rejectCommand(command: string, requestId: string, payload: Record<string, unknown>): void;
  observeVisibleFrame(): void;
  onStreamReplaced(): void;                                                          // invalidate
  resyncProof(): Promise<boolean>;
  snapshot(): StageBindingState;                                                     // A4 handoff, issue view, render
  dispose(): void;
}
```

Ports: `send`, `coordinator` (preauthorize, cancel, revisions, streamConfig; every call takes the module's `AbortSignal`, so the 45 s preauthorization deadline and the 5 s cancel timeout belong to this module, not to the client), `credentials()` / `ensureLease()`, `post` (parent messages), `mode()`, `tracker` (claim, hasContext), `timers` (setTimeout, clearTimeout, now), `onState`, `onCompleted` (mapping and children), `review` (event log line).

### 3. Incremental cutover

1. Module with the attempt machine, the proof and preauthorization; Window delegates and projects state; tests for begin, supersede, timeout, cancel barrier, proof block and resync.
2. Parent apply, Kit event routing and visible-frame promotion; Window's `_handleCustomEvent` forwards stage events first.
3. Delete Window privates; rewrite Window stage tests as module cases; A4 handoff and issue view read `snapshot()`.

## Considered Options

- Split Window by concern into React hooks: rejected; hooks would still share the same implicit state and privates.
- Put stage load into the Viewer Command Channel: rejected by that decision.
- Introduce Stage Binding Execution: accepted.

## Consequences

### Positive

- The interface is the test surface; nine regions become one module.
- Two of the four request-id generators go; A4 handoff and issue view read one snapshot.

### Negative

- Ten ports to fake.
- The cutover spans three PRs with Window in a hybrid state.
- Real Kit evidence is required for each cut.

## Verification

1. `cd web-viewer-sample && npx vitest run src/stageBinding src/console/windowParentMessage.dom.test.tsx src/console/WindowTraceAuthority.test.tsx` and `npx tsc --noEmit`.
2. Real-site Kit E2E on canonical Linux 181 per cut, operated in a visible Chrome with screenshots; first frame, Stage, DataChannel and ACK evidence recorded under `docs/evidence/`.
3. `git diff --check`.

## Rollback

Source revert per PR.
