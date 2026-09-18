# ADR: Viewer Command Channel

## Status

Accepted on 2026-09-18. Builds on [kit-command-vocabulary-adr.md](kit-command-vocabulary-adr.md):
that decision made the Kit↔viewer vocabulary a single source; this one does the same
for the viewer's own routing and for the console↔viewer `vg01` messages. Runtime
Mutation Authority policy is unchanged.

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
3. Commands of different shapes share one internal interface (`accept`, `receive`,
   `fail`, `sync`, `dispose`) rather than one implementation. Section plane now reuses
   `CorrelatedRuntimeExchange`; measurement keeps its session-shaped exchange behind
   an adapter.
4. The Viewer Embed Protocol is declared as a TypeScript discriminated union in the
   Channel module. Both ends live in one bundle, so the compiler is the drift check and
   no JSON schema copy is kept.

## Delivery

- PR 1 (this ADR): the iframe side, the registry, the protocol types for the Channel's
  commands, and a parameterised test run against every registered command. `vg01`
  wire format is unchanged.
- PR 2: the console side — one request/reply correlation in `EmbeddedViewer`, the three
  intermediate handle layers replaced by one command port, the section copy in
  `ViewportSlotProvider` removed, and the `*Bridge.ts` files moved inside the Channel.
  `ViewportSlotApi` keeps its named methods. Wire format unchanged.
- PR 3: the remaining `vg01` messages join the union, the two Python tests that read
  `vg01-postmessage-v1.schema.json` move to Vitest, and the schema is retired.
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

- A new viewer command is one registry entry plus a `CASES` row in
  `viewerCommandChannel/kitSide.test.ts`; the suite fails until the row exists, and
  every shared behaviour (refusal, transport failure, timeout, supersede, tracker
  claim) is then checked for it.
- Window-level DOM tests reach the Channel through `commandChannel` instead of
  per-command exchange fields.
