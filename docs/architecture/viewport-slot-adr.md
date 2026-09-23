# ADR: Narrow the Viewport Slot

## Status

Proposed on 2026-09-23 from the architecture review of the same date. The repository owner pre-authorized the recommended answer to every question in the Grilling Record. Accepted when this document merges to `main`.

Supersedes, in [viewer-command-channel-adr.md](viewer-command-channel-adr.md), the Delivery note "`ViewportSlotApi` keeps its named methods" and the Consequences sentence "The console UI still adds a named method to `ViewportSlotApi` and one `useViewerCommandState` line in `ViewportSlotProvider`". Everything else in that decision stands.

## Context

`web-viewer-sample/src/console/unified/viewportSlot.ts` declares `ViewportSlotApi` with 37 members (:49-103). Five viewer commands account for 14 of them (state, send and invalidate per command). `ViewportSlotProvider.tsx` (229 lines) implements most of the rest as one-line forwards to `hostActionsRef.current` (:118-139) and builds the `value` object across :175-226. The legacy `publish` / `publication` pair has no production consumer; its only references are four test files. The toolbar action literal union is restated four times (`viewportSlot.ts:43,96`, `ViewportSlotProvider.tsx:125`, `ReviewSessionViewerPane.tsx:138`). The viewer handle is reshaped four times on the way up: `EmbeddedViewerHandle` (10 members) → `ReviewSessionViewerPaneHandle` (7) → `ViewportHostActions` (5) → `ViewportSlotApi`; `WorkspaceViewportHost.tsx:96-106` re-wraps the pane handle and repeats the `viewer_unavailable` fallback that `ViewportSlotProvider.tsx:136` also has.

The gate is `ReviewSessionViewerPaneBatchGate { canSend; reason: string; canSendViewerCommand?; viewerCommandReason? }` (`ReviewSessionViewerPane.tsx:145-151`). Its reasons are i18n text: a nine-step ternary chain for single highlight (:620-639), a six-step chain for viewer commands (:671-686), and a batch verdict that adds mapping staleness on top of the command verdict (:684-686); plus a hand-built offline gate in the host (:118-130), a hand-built gate in `A1GovernanceWorkbenchPage.tsx:1392` and local placeholders in `VersionDiffPage.tsx:112,583`. `classifyViewerPhase` (`viewportSlot.ts:125-136`) recovers the phase by regex over the zh/en strings.

The Viewer Command Channel already registers each command once with its family, validator and reply parser (`viewerCommandChannel/registry.ts:187-212`); the slot is the last place that restates them. Canonical terms are defined in [`../../CONTEXT.md`](../../CONTEXT.md).

## Grilling Record

The repository owner pre-authorized the recommended answer for each question (2026-09-23).

| Question | Recommended answer (adopted) | Strongest objection | Adjudication |
|---|---|---|---|
| Reopen the five-day-old Viewer Command Channel consequence? | Yes, for the two sentences quoted in Status. | Churn. | That decision's own context complained about per-command restatement; the slot is the remaining restatement, and the registry now makes derivation possible. |
| Interface shape? | No per-command member: `commands: ViewerCommandPort`, `commandState(command)`, `invalidateCommands(family?)`. Measurement keeps its session-shaped state, setter and control. Session, gate, phase, stage tree and selection, host actions, slot and controls registration and dock publication remain. | Generic accessors lose discoverability. | Types are indexed by `ViewerCommandInputs` / `ViewerCommandReplies`, so the compiler still names every command; a new command needs zero slot edits. |
| Gate reason: text or code? | Structured, keeping today's two verdicts: `ViewerGate = { command: GateVerdict; batch: GateVerdict }` with `GateVerdict = { ok: true } \| { ok: false; reason: ViewerGateReason; detail? }`; `batch` adds `mapping_stale` on top of `command`. The pane computes both once through one pure `resolveViewerGate(evidence)`; the host and A1 produce `coordinator_offline` / `model_mismatch` verdicts of the same type; display text is derived from the code; `classifyViewerPhase` reads `command` and maps code → phase without regex. | Pages consume the gate through `onBatchGateChange`, and tests assert on it. | The ripple is mechanical (the gate producers and consumers, about a dozen files); keeping a text `reason` alongside would be layering; collapsing to one verdict would either disable the toolbar on a stale mapping or allow batch highlights on one. |
| Handle reshaping? | One `ViewerHostActions` type declared once (commands port, stage tree, select, toolbar, apply stage binding). `EmbeddedViewer` exposes it, the pane re-exports it, the host registers it, wrapping only `commands` with `forwardViewerCommandPort` for late binding. `ToolbarAction` is imported from the Viewer Embed Protocol everywhere. | — | — |
| Legacy `publish` / `publication`? | Delete, with their tests. | It is documented as a compatibility entry. | Zero production callers; tests were the only consumer. |
| WorkspacePage prop drilling? | Leaf controls keep explicit props (testable), now `{ commands, state }` from the generic accessors. | Reading the context in leaves is shorter. | Explicit inputs are the test surface of the controls. |
| Tests? | Provider tests parameterised over the registry (like the `CASES` table in `parentSide.test.ts`) with a fake command port; gate tests over codes; legacy publish tests and per-command provider tests deleted. | — | — |
| Cutover order? | Gate codes first (pane, host, FlowGuide, A1, VersionDiff), then the slot collapse, handle unification and legacy deletion. | — | — |

## Decision

### 1. Responsibility boundary

**Viewport Slot** is the console-owned contract between workspace pages and the single mounted viewer. It owns: which Review Session is being viewed, the Viewer Gate and its phase, the viewer command port with per-command state, measurement session state, the stage tree and selection, host action registration, and where the viewer rectangle and its controls are docked.

It does not own: command validation, correlation or `vg01` messages (Viewer Command Channel), the iframe (`EmbeddedViewer`), or lease and runtime evidence (`ReviewSessionViewerPane`).

### 2. Public surface

```ts
interface ViewportSlotApi {
  activeSessionId: string; setActiveSessionId(sessionId: string): void;
  gate: ViewerGate | null; setGate(gate: ViewerGate | null): void; phase: ViewerPhase;
  commands: ViewerCommandPort;
  commandState<C extends CorrelatedViewerCommand>(command: C): ViewerCommandState<ViewerCommandReplies[C]>;
  invalidateCommands(family?: ViewerCommandFamily): void;
  measurementState: MeasurementState; setMeasurementState(state: MeasurementState): void;
  controlMeasurement(action: MeasurementAction): boolean;
  stageTree: USDPrimNode[]; setStageTree(nodes: USDPrimNode[]): void;
  selectedStagePaths: string[]; setSelectedStagePaths(paths: string[]): void;
  hostActions: ViewerHostActions | null; registerHostActions(actions: ViewerHostActions | null): void;
  slotEl: HTMLElement | null; registerSlot(el: HTMLElement | null): void;
  controlsEl: HTMLElement | null; registerControls(el: HTMLElement | null): void;
  viewerPublication: WorkspaceViewerPublication | null; publishViewer(p: WorkspaceViewerPublication): void;
  dockSubscription: ViewportDockSubscription | null; subscribeDock(s: ViewportDockSubscription): () => void;
}
```

`ViewerGate = { command: GateVerdict; batch: GateVerdict }`, `GateVerdict` and `ViewerGateReason` (`no_session | session_not_observed | lease_not_active | waiting_first_frame | waiting_datachannel | stage_mismatch | mapping_stale | coordinator_offline | model_mismatch`) are declared once in `console/viewerGate.ts` together with `viewerGateText(reason, t)` and `classifyViewerPhase(activeSessionId, gate)`, which reads `gate.command`. The pane's single-highlight verdict (handoff-specific: missing `ifc_guid` or `usd_prim_path`) stays local to the pane and reuses `GateVerdict` with its own two reasons. The `command` verdict gates the toolbar and viewer commands; the `batch` verdict gates A2 batch highlight and the A1 issue view, exactly as `canSendViewerCommand` and `canSend` do today.

### 3. Provider

`ViewportSlotProvider` derives per-command state generically from `VIEWER_COMMAND_REQUESTS` (family, validate) with one hook; invalidation fans out by family; the measurement start gate stays in the provider; `publishViewer` / `subscribeDock` are unchanged. The host still wraps the pane's `commands` with `forwardViewerCommandPort` for late binding (Viewer Command Channel decision 5).

### 4. Incremental cutover

1. Gate codes: the pane computes both verdicts of `ViewerGate` once; the host offline gate, the A1 gate and the VersionDiff placeholders become codes; FlowGuide classifies by code. Display text is unchanged.
2. Slot collapse, `ViewerHostActions` unification, legacy deletion, union de-duplication; controls take `{ commands, state }`.

## Considered Options

- Keep named methods and add a generic escape hatch: rejected; two ways to do one thing.
- Move leaf controls onto the context: rejected (Grilling Record, row 6).
- Keep text reasons and classify by regex: rejected; phases break silently on copy edits.
- Narrow the Viewport Slot: accepted.

## Consequences

### Positive

- Adding a viewer command needs no slot or provider edit: only the registry, its tests and the control that uses it.
- The phase cannot drift from the gate text; one handle type; about 20 fewer members and three fewer type restatements.

### Negative

- Gate consumers (pages, tests) change type; the A2 batch-apply button reads `gate.batch.ok` instead of `canSend`.
- FlowGuide text is derived, so localisation edits move to `viewerGateText`.

## Verification

1. `cd web-viewer-sample && npx vitest run src/console/unified src/console/ReviewSessionViewerPane.test.tsx src/console/A1ViewerEmbed.test.tsx src/console/unified/WorkspaceFlowGuide.test.tsx` and `npx tsc --noEmit`.
2. The product-surface visual gate passes without re-baselining (no pixel change is intended).
3. Functional browser E2E on the console: gate phases through session select → lease → first frame → DataChannel → ready; camera, section, fly and overlay commands from WorkspacePage; A2 batch apply.
4. `git diff --check`.

## Rollback

Source revert; no persisted state.
