# ADR: Viewer Command Channel

## Status

Accepted on 2026-09-18. Builds on [kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md):
that decision made the Kit↔viewer vocabulary a single source; this one does the same
for the viewer's own routing and for the console↔viewer `vg01` messages. Runtime
Mutation Authority policy is unchanged.

Amended on 2026-09-23 by [viewport-slot-adr.md](viewport-slot-adr.md): the Delivery note
that `ViewportSlotApi` keeps its named methods and the Consequences sentence about adding a
named method per command are superseded. Amended on the same date by
[stage-binding-execution-adr.md](stage-binding-execution-adr.md): decision 2's "stage load
stay in Window" is superseded; stage load moves to its own module, still outside the Channel.
Everything else stands.

## Context

Each viewer command with a Kit reply (camera view, camera state, fly speed, section
plane, measurement) was restated in about seven places inside `Window.tsx`: exchange
construction, `sync`/`dispose`, the parent-message `switch`, the transport-failure
fan-out, the rejection fan-out, the result routing chain and the reply shape. The
console side repeated it again across four handle types. Missing one of those lists is
a bug that has already shipped: `cameraStateRequest` was absent from the rejection
fan-out until `de28254`. Request/reply correlation existed in three hand-written
variants, `vg01` message names were string literals on both ends, and
`tests/contracts/vg01-postmessage-v1.schema.json` no longer lists at least eleven of
the messages in use.

## Decision

1. A Viewer Command Channel module in `web-viewer-sample/src/viewerCommandChannel/`
   registers each viewer command once (`registry.ts`): the `vg01` request it accepts,
   the Kit command it sends and how its reply maps back to `vg01`. Which Kit results
   answer it and whether it mutates come from the Kit Command Vocabulary through
   `runtimeEventCatalog.ts` and `runtimeCommandProtocol.ts`; the registry does not
   restate them.
2. The iframe side (`kitSide.ts`) owns routing and correlation only. `Window.tsx`
   feeds it parent messages, Kit results, refusals and transport failures, and calls
   `sync`/`dispose` once. It uses Window through four ports (`send`, `snapshot`,
   `correlate`/`claimTerminal`, `post`); mutator blocking, lease stamping, tracker
   registration and stage load stay in Window. Only mutating commands claim a tracker
   terminal, which is decided from the vocabulary instead of per-command special cases.
   > Superseded in part on 2026-09-23 by [stage-binding-execution-adr.md](stage-binding-execution-adr.md):
   > stage load moves out of Window into `src/stageBinding/`; the rest of this item stands.
3. Commands of different shapes share one internal interface (`accept`, `receive`,
   `fail`, `sync`, `dispose`) rather than one implementation. Section plane now reuses
   `CorrelatedRuntimeExchange`; measurement keeps its session-shaped exchange behind
   an adapter.
4. The Viewer Embed Protocol is declared as a TypeScript discriminated union in the
   Channel module. Both ends live in one bundle, so the compiler is the drift check and
   no JSON schema copy is kept.
5. The console side (`parentSide.ts`) owns the one request/reply correlation: one
   outstanding request per family (camera view and camera state share the camera), a
   `vg01` broadcast of `unconfirmed` cancels every outstanding request, and each command's
   request and reply are registered next to its iframe entry (`VIEWER_COMMAND_REQUESTS`).
   Layers between `EmbeddedViewer` and `ViewportSlotProvider` pass one
   `ViewerCommandPort`; `forwardViewerCommandPort` turns a missing target or a closed
   gate into `unavailable` and still lets a measurement be cancelled or cleared.

## Delivery

- PR 1 (this ADR): the iframe side, the registry, the protocol types for the Channel's
  commands, and a parameterised test run against every registered command. `vg01`
  wire format is unchanged.
- PR 2: the console side — `parentSide.ts` replaces the three hand-written correlations
  in `EmbeddedViewer`, the three intermediate handle layers pass one command port, the
  section copy in `ViewportSlotProvider` now uses `useViewerCommandState`, and
  `cameraViewBridge.ts`, `sectionPlaneBridge.ts` and `measurementBridge.ts` became
  `camera.ts`, `sectionPlane.ts` and `measurement.ts` inside the Channel.
  `ViewportSlotApi` keeps its named methods. Wire format unchanged.
- PR 3: every remaining `vg01` message joins `viewerEmbedProtocol.ts` (the console→viewer
  requests as `ViewerParentMessage`, the viewer→console events as `ViewerEvent`), the
  console reads viewer events only through `parseViewerEvent` (fail-closed: wrong shape,
  wrong enum, or any credential field on an event drops the message; a `stage_loaded`
  without a status is normalised to `unproven`), the viewer reads the lease through
  `parseViewerLeaseToken`, the three Python tests that read
  `vg01-postmessage-v1.schema.json` become `viewerEmbedProtocol.test.ts`, and the schema
  is deleted. The message interfaces `EmbeddedViewer.tsx` used to declare are re-exported
  from there so its ten importers did not move.
- Later: issue view, mapping highlight/focus, governance batch highlight and the A4
  handoff, which share Kit highlight/focus results and need Window's mapping cache.

## Alternatives rejected

- One generic exchange for every command: measurement's session and issue view's
  concurrent requests would leak into configuration and widen the interface.
- Let the Channel own the send pipeline too: it would pull stage load and the
  viewer-side Runtime Mutation Authority execution into this module.
- Keep the `vg01` JSON schema as the source and generate TypeScript: no second runtime
  reads it, so generation adds a step without catching anything the compiler would not.
- Put issue view in the first cut: its sends go through Window's overlay highlight and
  mapping cache, which would add ports belonging to the highlight family.

## Consequences

- A new viewer command is its entries in `registry.ts` (iframe side, and for a
  request/reply command also `VIEWER_COMMAND_REQUESTS`, which the compiler requires once
  the command is added to `ViewerCommandInputs`) plus a `CASES` row in `kitSide.test.ts`
  and `parentSide.test.ts`. Both suites fail until the rows exist, and then check every
  shared behaviour for it: refusal, transport failure, timeout, supersede and tracker
  claim on the iframe side; invalid, unavailable, busy, transport, timeout and
  broadcast invalidation on the console side. The console UI still adds a named method
  to `ViewportSlotApi` and one `useViewerCommandState` line in `ViewportSlotProvider`.
  > Superseded in part on 2026-09-23 by [viewport-slot-adr.md](viewport-slot-adr.md): the last
  > sentence no longer applies; the slot derives per-command state from the registry and adds
  > no named method per command. The registry and test rows above stand.
- Window-level DOM tests reach the Channel through `commandChannel` instead of
  per-command exchange fields.
