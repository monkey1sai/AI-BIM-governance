# C M4 Runtime Command Bridge Design

> 日期：2026-07-03
> 類型：AI-BIM Geo Viewer M4 runtime-command / primary-spectator-session spec
> Scope：`web-viewer-sample` viewer shell、coordinator session/lease authority、Kit WebRTC DataChannel mutator boundary

## 決策摘要

採用 C：**M4 Runtime Command Bridge**。

C 是保守路線：

- 不新增泛用 `/operations` backend platform。
- 不把 `ai-bim-geo-viewer-prototype.html` 的自寫 canvas 當正式 3D runtime。
- 不讓 coordinator 變成 3D command broker。
- 不把 `disabled` / spectator UI 當授權邊界。
- 不把 harness/mock ack 當 real Kit/WebRTC evidence。

正式 viewer 行為維持：

```txt
human operation
  -> browser UI-local intent or runtime mutator
  -> primary/session/readiness gate
  -> WebRTC DataChannel command
  -> Kit handler applies runtime action
  -> Kit ack / runtime evidence
  -> UI trace/result
```

## Source of truth

- `docs/plans/docs-plans-README.md`：`ai-bim-geo-viewer-prototype.html` 是 M4 驗收示意；正式版來自 Kit WebRTC 串流，前端只收 frame、指令走 DataChannel。
- `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md`：IX-A1-08、IX-SS-05、IX-3D-01/02/03/04/05 是 C 行為合約。
- `docs/plans/ai-bim-governance-前端對齊DS-保留後端-實作手冊.md`：browser 不直連 governance/Kit manager/conversion authority；`apply-overlay` by design 501，3D coloring 走 client `highlightPrimsRequest`。
- Current code is the runtime truth for exact handler names and existing route availability.

## In scope

### 1. Viewer IA alignment

The M4 viewer shell should align to the prototype's seven information blocks while staying honest about runtime state:

1. Pick/select element.
2. IFC semantic: type/name/global id.
3. Pset/Qto.
4. Spatial relation.
5. GUID to USD Prim Path mapping.
6. A1 overlay/highlight bridge result.
7. Reverse jump from table/tree/list back to 3D focus/highlight.

`Role` and `Session` remain visible, but they are evidence/authority metadata. They must not replace A1 overlay or reverse jump in the seven-block IA.

### 2. UI-local intents

These are browser-local behaviors and should not require backend authorization:

```txt
select_tree_node
select_mapping_row
select_semantic_row
open_property_panel
switch_semantic_tab
show_readonly_session_evidence
```

They can update selected GUID, right-side semantic panels, row highlight, and bottom mapping strip.

### 3. Runtime mutators

These can change stage, camera, selection, highlight, overlay, or pickability and must be primary-only:

```txt
openStageRequest
loadArtifactGroupRequest
selectPrimsRequest
focusPrimRequest
highlightPrimsRequest
clearHighlightRequest
makePrimsPickable
resetStage
```

Current repo status note:

- `loadArtifactGroupRequest` plus `stage_composition` is the real current path for composed stage loading.
- `composeStageRequest` / `bindingApplied` appears in frontend or harness work, but Packet 02 did not verify a real Kit handler for that command/result pair. C implementation must not rely on it for production runtime evidence until a real handler is found or explicitly added.
- If any frontend path still emits `composeStageRequest`, it remains a mutating frontend event and must be gated, but it is not the formal C runtime command.

Runtime mutators require:

```txt
active review session
primary viewer role
current or valid primary lease where available
DataChannel ready when command requires DataChannel
first_frame_at when command claims visible result
stage matched for element-level highlight/focus
usd_prim_path present for element-level commands
ack or timeout trace recorded in UI
```

### 4. Read-only DataChannel queries

These may remain spectator-safe if product accepts local read-only scene inspection:

```txt
loadingStateQuery
getChildrenRequest
```

If a read-only query can indirectly change selection, camera, stage, or overlay, it must be reclassified as a runtime mutator.

### 5. Coordinator role

Coordinator remains authority for:

```txt
review session lifecycle
stream-config
runtime/status
viewer-leases claim/heartbeat/release/status
stage-binding authorization
governance proxy
Kit manager proxy where already present
```

Coordinator must not become:

```txt
generic 3D command broker
source model mutator
browser-visible governance-service replacement
Kit scene runtime
```

### 6. Kit/DataChannel role

Kit remains authority for actual runtime effects:

```txt
stage open/load
scene tree
selection
focus/camera
highlight/clear
pickability/reset
ack event emission
```

C requires hardening for mutating events so a spectator or forged client cannot mutate state by bypassing frontend controls.

## Out of scope

- Rebuilding a web canvas 3D engine.
- Adding a generic `/api/review-sessions/:id/operations` resource.
- Changing governance-service APIs.
- Making `apply-overlay` return successful server-push 3D coloring.
- Changing GPU capacity, Kit process lifecycle, or live migration semantics.
- Declaring full M4 done without real Kit/WebRTC evidence.

## Human operation contract

### Selection from tree/table/panel

```txt
User clicks IFC tree node or mapping row
  -> UI-local selectedGuid and selectedPrimPath update
  -> semantic/Pset/Spatial panels update
  -> mapping row highlight updates
  -> if primary and focus requested and readiness is green:
       send focusPrimRequest
     else:
       record local readonly selection trace
```

### Selection from live frame

```txt
User picks a visible 3D element
  -> Kit emits stageSelectionChanged or equivalent event
  -> viewer maps USD prim path to IFC GUID through mapping cache
  -> UI panels update
  -> no governance mutation occurs
```

### A1 highlight

```txt
A1 failure list or Review Room asks to highlight failed elements
  -> read A1 run / session / first-frame / DataChannel / stage-match evidence
  -> reject if any evidence is missing
  -> reject if any selected element lacks usd_prim_path
  -> primary sends highlightPrimsRequest
  -> UI trace remains pending until highlightPrimsResult ack
  -> timeout/failure stays visible and does not mark success
```

### Spectator

```txt
Spectator may view stream and inspect read-only UI state
Spectator must not send runtime mutators
Spectator bypass attempts must be rejected outside frontend UI
```

## Evidence model

UI can show:

```txt
runtime_mode: live | harness | unavailable
role: primary | spectator
session_id
first_frame_at
datachannel_ready
expected_stage_url
loaded_stage_url
stage_match
mapping_url
mapping_fidelity
last_command_trace
last_ack_trace
```

Evidence labels:

- `live`: observed from real video/DataChannel/runtime logs.
- `harness`: deterministic fake for UI regression only.
- `unavailable`: honestly absent.
- `blocked`: command cannot run and UI explains which gate is missing.

## Three-layer deep verification

### Layer 1: Contract and unit verification

Purpose: prove classification and authority logic without browser/runtime flake.

Checks:

- UI-local intents do not call `AppStream.sendMessage`.
- Runtime mutators are primary-only.
- Spectator attempts are rejected before send in frontend.
- Coordinator `stage-binding` rejects missing or non-primary lease token.
- Mutator allowlist and read-only allowlist are explicit.
- `composeStageRequest` is not treated as production runtime proof unless a real handler is verified.

Evidence examples:

```powershell
npm test -- primary-spectator-authority
npm test -- stage-artifact-binding
```

### Layer 2: Browser and harness E2E

Purpose: prove user-facing layout and deterministic UI behavior.

Checks:

- Viewer has one page scrollbar at most.
- No removed debug foreground panels return.
- M4 IA appears as left model/tree, center live/honest viewport, right semantic/Pset/Spatial, bottom mapping strip.
- Mapping row/tree selection updates semantic panels.
- Primary harness can send a mutator and receive fake ack.
- Spectator harness shows readonly state and cannot trigger mutator send.

Evidence examples:

```powershell
npx playwright test e2e/gov-viewer-layout.spec.ts
npx playwright test e2e/primary-spectator-authority.spec.ts
```

### Layer 3: Real runtime and adversarial verification

Purpose: prove C is not just a mock UI.

Checks:

- Real browser video has first frame: `readyState`, `videoWidth`, `videoHeight`, `currentTime`.
- Real DataChannel returns `openedStageResult`, `highlightPrimsResult`, `focusPrimResult`, or `clearHighlightResult`.
- Real `stage_match` comes from expected vs loaded stage evidence, not timer.
- Spectator bypass attempt sends `selectPrimsRequest` or `openStageRequest` directly and is rejected by runtime authority.
- Fake mapping or harness result never enables formal mapping correctness claim.

Evidence examples:

```powershell
npx playwright test e2e/real-ifc-viewer-lineage.spec.ts
npx playwright test e2e/real-ifc-conversion-lineage.spec.ts
```

Layer 3 can be skipped only with an explicit final label: `runtime evidence not collected in this run`.

## Model and reasoning routing

| Work type | Model/effort route | Reason |
| --- | --- | --- |
| C architecture and integration decision | parent / high to xhigh discipline | Cross-service runtime boundary and authorization risk |
| Frontend/session repo status | `gpt-5.4` / high explorer | Multiple TS/React/E2E entry points |
| Runtime/Kit auth repo status | `gpt-5.4` / high explorer | Shared session/Kit authorization risk |
| Plan/spec formatting and checklist validation | parent / medium-high | Needs exact repo paths, lower runtime uncertainty |
| Final adversarial verification before implementation | strongest available / high or xhigh | Must challenge boundary violations and fake evidence |

## Acceptance criteria for the spec phase

- Spec file exists.
- Implementation plan exists.
- Workflow artifact records packets, agent routing, integration, and verification status.
- No runtime source code is changed in this phase.
- All runtime/security claims are labelled as verified, inferred, or unverified.

## Repo status synthesized on 2026-07-03

### Frontend/session status

- Verified: frontend DataChannel builders exist for `openStageRequest`, `loadingStateQuery`, `getChildrenRequest`, `highlightPrimsRequest`, `focusPrimRequest`, and `clearHighlightRequest`.
- Verified: `_sendStreamMessage()` is the central frontend send path.
- Verified: spectator/front-end lifecycle gates exist for select/focus, binding apply, parent-message highlight/focus/clear, and overlay operability.
- Verified: current layout already has left tree and central stream/harness, but right semantic rail and bottom mapping strip are not fixed C regions yet.
- Inference: C can reuse most current frontend command entry points without a new backend API.

### Coordinator/runtime status

- Verified: coordinator has real session/lease authority through `ViewerLeaseStore` and stage-binding authorization.
- Verified: `stage-binding` rejects missing, spectator, or non-primary lease in tests.
- Verified: real Kit handlers currently process raw `openStageRequest`, `loadArtifactGroupRequest`, `selectPrimsRequest`, `makePrimsPickable`, `resetStage`, `highlightPrimsRequest`, `clearHighlightRequest`, and `focusPrimRequest` without verified lease/role/session checks.
- Verified: `stage_composition` is real and tested; `composeStageRequest` / `bindingApplied` are not verified real Kit protocol in the scoped runtime files.
- Inference: C is incomplete until Kit/DataChannel mutator authorization is added or an equivalent runtime authority path is proven.
