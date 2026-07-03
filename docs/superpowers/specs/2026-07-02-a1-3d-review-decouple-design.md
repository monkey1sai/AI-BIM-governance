# A1 3D Review Decoupling Design

> 日期：2026-07-02  
> 類型：A1 3D highlight architecture bug fix spec  
> Scope：`web-viewer-sample` A1 console / dedicated 3D review screen / coordinator handoff  
> 狀態：approved implementation spec for `spec-to-done`

## 1. Problem

A1 currently combines governance rule-run, session discovery, primary viewer lease, embedded WebRTC viewer, first-frame evidence, stage matching, and 3D highlight commands inside `A1GovernanceWorkbenchPage`.

This is the wrong product shape for the reported bug:

- The user explicitly requires a reconstructed/dedicated screen for 3D highlight, not a viewer embedded in the A1 workbench.
- Kit session startup must be explicit/manual, not assumed from an already-active session and not triggered implicitly by page mount.
- Canonical `IX-3D-01` says the viewer opens through coordinator `/ui/open?session=` and is not embedded as WebRTC inside the console.

## 2. Verified Current Evidence

- `web-viewer-sample/src/console/pages.tsx` imports `EmbeddedViewer`.
- A1 calls `runtimeStatus()` on mount and uses it as session/viewer-origin source.
- A1 advances state when `selectedSession` exists.
- A1 calls `claimViewerLease(selectedSession, ...)`.
- A1 renders `3D 即時檢視（嵌入 live viewer）`.
- A1 mounts `EmbeddedViewer`.
- `docs/plans/ai-bim-governance-互動實作規格與標準對齊.md` says `IX-3D-01` opens `coordinator /ui/open?session=` and does not embed WebRTC in console.
- `IX-A1-06` defines A1 3D highlight enablement as DataChannel ready, first frame present, stage matched, and element has `usd_prim_path`.

## 3. Conflicting Prior Specs

These prior specs are now treated as stale for A1 inline viewer behavior:

- `docs/superpowers/specs/2026-06-24-a1-governance-3d-minio-redesign-design.md` retained `EmbeddedViewer` and inline 3D highlight in A1.
- `docs/superpowers/specs/2026-07-02-a1-primary-viewer-lease-authority-design.md` formalized A1 console owning an embedded viewer primary lease.

The useful part of the primary lease spec remains valid for the standalone/dedicated viewer: coordinator remains the lease authority, lease tokens must not be placed in URLs, and mutating viewer commands still require an active primary lease.

## 4. Non-Negotiables

1. A1 governance workbench must not mount `EmbeddedViewer` or any WebRTC iframe.
2. A1 page mount must not claim primary viewer lease.
3. A1 page mount must not auto-select the first active review session as a hidden side effect.
4. Starting a Kit/review session must be an explicit user action.
5. 3D highlight must be performed in a dedicated review surface.
6. A1 may hand off `rule_run_id`, `review_session_id`, `ifc_guid`, and `usd_prim_path` intent, but it must not pass viewer lease tokens through URLs.
7. If `usd_prim_path` is missing, the UI must show an honest disabled state, not a fake highlight success.

## 5. Target UX

### A1 Governance Workbench

A1 becomes a governance workflow page:

1. Pick IFC source.
2. Trigger or attach to conversion/session only by explicit button.
3. Run governance rule-run.
4. Show score, failed rules, failed elements, issues, Excel, and BCF.
5. For a failed element, show `Open in 3D Review` when the handoff is meaningful.

A1 does not show a live viewport.

### Dedicated 3D Review Screen

Preferred target: reconstruct the existing `#review` / `#gpu` Review Room into the dedicated 3D review surface. This preserves the canonical IA already documented for Review Room and avoids creating a second viewer architecture. A new `#a1-3d` route is only a fallback if `#review/#gpu` cannot be safely expanded in the first implementation slice.

The Review Room owns:

- Kit session start / attach controls.
- Viewer launch or embedded full-screen review canvas, depending on final route choice.
- Primary/spectator lease state.
- WebRTC first-frame evidence.
- Stage match evidence.
- DataChannel command trace.
- Highlight/focus/isolate actions.
- Failure drawer seeded from A1 handoff.

## 6. Lifecycle State Machine

```txt
no_rule_run
  -> rule_run_ready
  -> failures_ready
  -> review_requested
  -> kit_not_started
  -> kit_starting        (explicit user action only)
  -> kit_ready
  -> viewer_opening
  -> first_frame_seen
  -> datachannel_ready
  -> highlight_sent
  -> highlight_ack | highlight_failed
```

Important split:

- Governance run readiness is not Kit readiness.
- Review session existence is not first-frame readiness.
- First frame is not stage match.
- Stage match is not highlight ack.

## 7. Handoff Contract

Recommended handoff payload:

```ts
interface A1ReviewHandoff {
  source: "a1";
  rule_run_id: string;
  review_session_id?: string;
  ifc_guid?: string;
  usd_prim_path?: string;
  rule_code?: string;
}
```

Transport:

- URL query/hash may carry non-secret IDs: `source=a1`, `rule_run_id`, `session`, `ifc_guid`, `rule_code`.
- Do not put viewer lease token in URL.
- The dedicated screen claims/refreshes lease through coordinator after user intent is explicit.

## 8. Tournament

| Option | Shape | UX fit | Spec fit | Runtime safety | Testability | Migration cost | Score | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---|
| A | New `#a1-3d` route dedicated to A1 failures and Kit viewer controls | 4 | 4 | 4 | 4 | 3 | 22 | Fallback only |
| B | Reuse/reconstruct `#review` / `#gpu` Review Room and add A1 handoff state | 5 | 5 | 5 | 4 | 4 | 26 | Winner |
| C | Keep A1 embedded viewer but require manual start | 2 | 1 | 2 | 3 | 5 | 17 | Rejected |

Winner: Option B. It satisfies the user's requirement because 3D is no longer embedded inside A1; it is shown in the dedicated Review Room surface already defined by the repo's canonical IA.

Fallback: Option A. If the current `#review/#gpu` implementation is too thin to safely evolve in the first slice, create `#a1-3d` as an A1-mode child of the Review Room concept, then converge it back into `#review?source=a1` / `#gpu?source=a1`.

Rejected: Option C because even manual startup still leaves 3D inside A1, which violates the user's requirement and `IX-3D-01`.

## 9. Model Routing

| Work type | Difficulty | Suggested model / effort | Reason |
|---|---:|---|---|
| Architecture arbitration and final integration | High | `gpt-5.5`, high or xhigh | Cross-cutting UX, runtime, security, and test implications. |
| Current flow audit | Medium-High | `gpt-5.4`, high | Read-heavy code tracing with concrete evidence. |
| Tournament and adversarial review | High | `gpt-5.5`, high | Needs independent challenge of product and runtime assumptions. |
| Production implementation worker | High | `gpt-5.4`, high | Multi-file frontend refactor plus focused tests. |
| Test/checklist maintenance | Medium | `gpt-5.4-mini`, medium | Bounded assertions and artifact scans. |

The skill does not change host runtime settings by itself; model routing is enforced only when the host exposes model overrides.

## 10. Implementation Scope

Expected future code changes:

- `web-viewer-sample/src/console/pages.tsx`
  - Remove A1 `EmbeddedViewer` import and ref.
  - Remove A1 auto viewer lease claim.
  - Remove A1 inline `3D 即時檢視（嵌入 live viewer）` panel.
  - Add `Open in 3D Review` handoff buttons.
  - Keep governance rule-run, failures, issue, Excel, and BCF behavior.
- `web-viewer-sample/src/console/data.ts`
  - Preserve `#review/#gpu` as the canonical Review Room entry. Add route metadata only if the implementation chooses the fallback `#a1-3d`.
- `web-viewer-sample/src/console/pages.tsx`
  - Expand `ReviewRoomPage` / `GpuReviewRoomPage` into the dedicated A1 handoff target.
- `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
  - New reusable viewer lane component for Review Room: manual attach/start, lease, first frame, stage truth, command trace, highlight.
- `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - Replace old embedded-viewer assertions with decoupling tests or retire the file if covered by new route tests.
- `web-viewer-sample/src/console/console.test.tsx`
  - Add route and A1 no-embed assertions.
- `web-viewer-sample/src/App.tsx`
  - Reuse existing viewer-side lease and DataChannel behavior where applicable.

Backend changes should be avoided unless no existing explicit session-start/attach endpoint exists. If a backend change is needed, it must stay behind coordinator APIs.

## 11. Verification Gates

### Unit / Component

- A1 render does not include `EmbeddedViewer`.
- A1 mount does not call `claimViewerLease`.
- A1 mount does not auto-select first active session.
- A1 still can run `createRuleRunForSession` after the user explicitly chooses a session or a completed conversion result.
- `Open in 3D Review` is disabled when no `rule_run_id` or no failed element exists.
- `Open in 3D Review` shows honest disabled reason when `usd_prim_path` is missing.

### Route / Handoff

- `#review?source=a1` or `#gpu?source=a1` opens with `rule_run_id` and optional `session`.
- Review Room shows `Kit not started` until the user clicks the start/attach control.
- Review Room does not claim primary lease before explicit user action.
- Lease token never appears in URL.

### Browser E2E

- From A1, run governance and open a failed element in 3D Review.
- Confirm the browser navigates to `#review` / `#gpu` or opens coordinator `/ui/open?session=` as the distinct review surface.
- Confirm no WebRTC viewport is embedded in A1.
- Confirm manual Kit session start/attach flow is visible.
- Confirm first-frame, stage-match, DataChannel, and highlight ack are shown as separate evidence.

### Adversarial Checks

- Stale browser tab with old session ID must show `session not found` and offer manual reselect/start, not silently pick another active session.
- Multiple active sessions must not cause A1 to pick `act[0]`.
- Missing `usd_prim_path` must block highlight.
- No Kit runtime must not look like a governance failure.
- Viewer lease conflict must produce an honest spectator/blocked state.

## 12. Acceptance Criteria

- A1 is governance-first and has no inline live viewer.
- Dedicated 3D review screen is the only place that owns WebRTC / Kit session / lease / DataChannel highlight.
- Kit session startup is explicit.
- The UI makes stale session, missing mapping, no first frame, stage mismatch, and lease conflict distinguishable.
- Tests fail if A1 reintroduces `EmbeddedViewer` or automatic lease claim.
