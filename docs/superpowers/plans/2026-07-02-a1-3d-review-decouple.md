# A1 3D Review Decoupling Implementation Plan

> Status: Historical plan. The equivalent A1 -> Review Room decoupling implementation already landed on main; keep this file as the source plan referenced by later specs, not as an active unchecked task list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move A1 3D highlight out of the A1 governance workbench into the dedicated Review Room surface, with explicit/manual Kit session startup.

**Architecture:** A1 remains the governance UI for source selection, conversion trigger, rule-run, failures, issues, Excel, and BCF. The existing `#review/#gpu` Review Room becomes the dedicated 3D surface that owns Kit session attach/start, primary viewer lease, WebRTC first-frame evidence, stage match, DataChannel trace, and highlight/focus commands. A1 hands off IDs and selected failure context only.

**Tech Stack:** React, TypeScript, Vitest, existing coordinator client APIs, existing `EmbeddedViewer` postMessage bridge, existing governance proxy APIs.

---

## File Structure

- Modify: `web-viewer-sample/src/console/pages.tsx`
  - Remove A1 embedded viewer state/effects/rendering.
  - Add A1 handoff CTA to `#review?source=a1`.
  - Expand existing `ReviewRoomPage` / `GpuReviewRoomPage` as the dedicated 3D review target.
- Create: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
  - Reusable Review Room viewer lane: manual attach/start, primary lease, first-frame/stage/DataChannel evidence, highlight command trace.
- Modify or replace: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
  - Convert old A1 embedded-viewer tests into decoupling tests and/or new Review Room tests.
- Modify: `web-viewer-sample/src/console/console.test.tsx`
  - Add A1 no-embed tests and Review Room handoff tests.
- Keep: `web-viewer-sample/src/console/EmbeddedViewer.tsx`
  - Reuse inside Review Room only; do not mount it in A1.
- Keep unless blocked: `bim-review-coordinator/src/app.ts`
  - No backend change unless no existing explicit session attach/start endpoint can satisfy the UX.

## Task 1: Lock Failing Tests For A1 No-Embed Contract

**Files:**
- Modify: `web-viewer-sample/src/console/A1ViewerEmbed.test.tsx`
- Modify: `web-viewer-sample/src/console/console.test.tsx`

- [ ] **Step 1: Write failing test that A1 does not render an embedded viewer**

```tsx
it("A1 workbench does not mount EmbeddedViewer or inline WebRTC viewport", async () => {
  const runtimeSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);
  const claimSpy = vi.spyOn(coordinatorClient, "claimViewerLease").mockImplementation(((sessionId: string) => Promise.resolve(fakePrimaryLease(sessionId))) as never);

  renderA1();
  await flush();

  expect(box.current).toBeNull();
  expect(document.querySelector('[data-testid="a1-embedded-viewer"]')).toBeNull();
  expect(document.body.textContent || "").not.toContain("3D 即時檢視（嵌入 live viewer）");
  expect(runtimeSpy).toHaveBeenCalled();
  expect(claimSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Write failing test that A1 does not auto-select `act[0]`**

```tsx
it("A1 does not auto-select the first active session on mount", async () => {
  vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus(VIEWER_ORIGIN) as never);

  renderA1();
  await flush();

  const sessionSelect = document.querySelector('[data-testid="a1-session-select"]') as HTMLSelectElement | null;
  if (sessionSelect) expect(sessionSelect.value).toBe("");
  expect(document.querySelector('[data-testid="a1-step-run"]')?.getAttribute("disabled")).not.toBeNull();
});
```

- [ ] **Step 3: Run red test**

```powershell
npm test -- A1ViewerEmbed.test.tsx
```

Expected before implementation: FAIL because current A1 still auto-selects a session, claims a lease, and mounts `EmbeddedViewer`.

## Task 2: Remove Viewer Ownership From A1

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`

- [ ] **Step 1: Remove A1 import dependency**

```tsx
-import { EmbeddedViewer, type EmbeddedViewerHandle } from "./EmbeddedViewer";
```

- [ ] **Step 2: Remove A1 viewer-only state and effects**

Remove A1 state/effects that own the viewer lane:

```tsx
- const [viewerOrigin, setViewerOrigin] = useState<string | null>(null);
- const [viewerLease, setViewerLease] = useState<ViewerLease | null>(null);
- const [viewerLeaseError, setViewerLeaseError] = useState<string | null>(null);
- const [firstFrame, setFirstFrame] = useState(false);
- const [loadedStageUrl, setLoadedStageUrl] = useState<string | null>(null);
- const [viewerMountAttempt, setViewerMountAttempt] = useState(0);
- const viewerRef = useRef<EmbeddedViewerHandle>(null);
```

Also remove A1 effects that call `claimViewerLease`, `viewerLeaseHeartbeat`, `releaseViewerLease`, and `reportFirstFrame`.

- [ ] **Step 3: Replace inline 3D panel with Review Room handoff**

```tsx
function buildReviewRoomHandoff(args: { runId: string; sessionId?: string; ifcGuid?: string; usdPrimPath?: string; ruleCode?: string }): string {
  const p = new URLSearchParams();
  p.set("source", "a1");
  p.set("rule_run_id", args.runId);
  if (args.sessionId) p.set("session", args.sessionId);
  if (args.ifcGuid) p.set("ifc_guid", args.ifcGuid);
  if (args.usdPrimPath) p.set("usd_prim_path", args.usdPrimPath);
  if (args.ruleCode) p.set("rule_code", args.ruleCode);
  return `#review?${p.toString()}`;
}
```

```tsx
<Panel
  title={t("3D 審查畫面", "3D Review Room")}
  sub={t("3D 高亮在 Review Room 執行；A1 只傳遞 rule-run 與失敗構件脈絡", "3D highlighting runs in Review Room; A1 only hands off rule-run and failed-element context")}
  prov="asbuilt"
>
  <p className="ec-note" data-testid="a1-3d-handoff-note">
    {t("Kit session 不會自動啟動。請先完成規則檢核，再開啟 Review Room。", "Kit session is not started automatically. Run governance first, then open Review Room.")}
  </p>
  <Btn
    data-testid="a1-open-review-room"
    disabled={!state.runId || failures.length === 0}
    caption={!state.runId ? t("需先完成治理檢核", "Run governance first") : failures.length === 0 ? t("無失敗構件可高亮", "No failed elements to highlight") : t("開啟 Review Room", "Open Review Room")}
    onClick={() => {
      const f = failures[0];
      window.location.hash = buildReviewRoomHandoff({
        runId: state.runId,
        sessionId: selectedSession || undefined,
        ifcGuid: f?.ifc_guid || undefined,
        usdPrimPath: f?.usd_prim_path || undefined,
        ruleCode: f?.rule_code || undefined,
      });
    }}
  >
    {t("開啟 Review Room", "Open Review Room")}
  </Btn>
</Panel>
```

- [ ] **Step 4: Run focused tests**

```powershell
npm test -- A1ViewerEmbed.test.tsx
```

Expected after implementation: PASS for A1 no-embed, no auto-lease, no auto-select assertions.

## Task 3: Create Review Room Viewer Pane

**Files:**
- Create: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Test: `web-viewer-sample/src/console/ReviewSessionViewerPane.test.tsx`

- [ ] **Step 1: Add handoff parser**

```tsx
export interface ReviewRoomHandoff {
  source: string;
  ruleRunId: string;
  sessionId: string;
  ifcGuid: string;
  usdPrimPath: string;
  ruleCode: string;
}

export function parseReviewRoomHandoff(hash: string): ReviewRoomHandoff {
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const p = new URLSearchParams(query);
  return {
    source: p.get("source") || "",
    ruleRunId: p.get("rule_run_id") || "",
    sessionId: p.get("session") || "",
    ifcGuid: p.get("ifc_guid") || "",
    usdPrimPath: p.get("usd_prim_path") || "",
    ruleCode: p.get("rule_code") || "",
  };
}
```

- [ ] **Step 2: Write test that lease is claimed only after manual action**

```tsx
it("does not claim primary viewer lease before manual start", async () => {
  const claimSpy = vi.spyOn(coordinatorClient, "claimViewerLease").mockResolvedValue(fakePrimaryLease("review_session_test") as never);

  render(<ReviewSessionViewerPane handoff={{ source: "a1", ruleRunId: "rr_test", sessionId: "review_session_test", ifcGuid: "", usdPrimPath: "", ruleCode: "" }} />);
  await flush();

  expect(claimSpy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("review-room-manual-start"));
  await flush();

  expect(claimSpy).toHaveBeenCalledWith("review_session_test", expect.objectContaining({ requested_role: "primary" }));
});
```

- [ ] **Step 3: Implement manual attach/start UI**

```tsx
export function ReviewSessionViewerPane({ handoff }: { handoff: ReviewRoomHandoff }): JSX.Element {
  const [sessionId, setSessionId] = useState(handoff.sessionId);
  const [started, setStarted] = useState(false);
  const [lease, setLease] = useState<ViewerLease | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startManually(): Promise<void> {
    setError(null);
    if (!sessionId) {
      setError("No review session selected");
      return;
    }
    const nextLease = await coordinatorClient.claimViewerLease(sessionId, {
      requested_role: "primary",
      viewer_id: identity.viewer_id,
      user_id: identity.user_id,
      display_name: identity.display_name,
      client_nonce: `${identity.viewer_id}:${sessionId}:primary`,
    });
    setLease(nextLease);
    setStarted(true);
  }

  return (
    <section data-testid="review-session-viewer-pane">
      <input data-testid="review-room-session-input" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
      <button data-testid="review-room-manual-start" onClick={startManually}>Start / attach Kit session</button>
      {!started && <p data-testid="review-room-kit-not-started">Kit session not started</p>}
      {error && <p data-testid="review-room-error">{error}</p>}
      {started && lease?.status === "active" && <div data-testid="review-room-viewer-host" />}
    </section>
  );
}
```

Use the existing local viewer identity helper from `pages.tsx`; if it is not exportable, extract it without changing behavior.

## Task 4: Expand `#review/#gpu` To Consume A1 Handoff

**Files:**
- Modify: `web-viewer-sample/src/console/pages.tsx`
- Test: `web-viewer-sample/src/console/console.test.tsx`

- [ ] **Step 1: Add route test**

```tsx
it("Review Room consumes A1 handoff and shows manual Kit startup state", async () => {
  window.location.hash = "#review?source=a1&rule_run_id=rr_test&session=review_session_test&ifc_guid=abc";
  renderConsole();
  await flush();

  expect(document.querySelector('[data-testid="review-session-viewer-pane"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="review-room-kit-not-started"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="review-room-viewer-host"]')).toBeNull();
});
```

- [ ] **Step 2: Render `ReviewSessionViewerPane` inside Review Room**

```tsx
const handoff = parseReviewRoomHandoff(window.location.hash);
const hasA1Handoff = handoff.source === "a1" && Boolean(handoff.ruleRunId);

return (
  <>
    {hasA1Handoff && <ReviewSessionViewerPane handoff={handoff} />}
    {/* keep existing Review Room link/open controls for non-A1 usage */}
  </>
);
```

- [ ] **Step 3: Keep `/ui/open?session=` as viewer attach path**

Do not put lease token in `#review` query or `/ui/open` query. URL may carry only opaque IDs such as `session`, `rule_run_id`, `ifc_guid`, and `rule_code`.

## Task 5: Connect Highlight Only From Review Room

**Files:**
- Modify: `web-viewer-sample/src/console/ReviewSessionViewerPane.tsx`
- Test: `web-viewer-sample/src/console/ReviewSessionViewerPane.test.tsx`

- [ ] **Step 1: Add disabled test for missing mapping**

```tsx
it("disables highlight when handoff has no usd_prim_path", async () => {
  render(<ReviewSessionViewerPane handoff={{ source: "a1", ruleRunId: "rr_test", sessionId: "review_session_test", ifcGuid: "abc", usdPrimPath: "", ruleCode: "R1" }} />);
  await flush();

  expect(screen.getByTestId("review-room-highlight").getAttribute("disabled")).not.toBeNull();
  expect(screen.getByTestId("review-room-highlight-reason").textContent || "").toContain("usd_prim_path");
});
```

- [ ] **Step 2: Send highlight through `EmbeddedViewer` ref only after evidence gates**

```tsx
const canHighlight = Boolean(started && firstFrame && stageMatched && handoff.usdPrimPath);

<button
  data-testid="review-room-highlight"
  disabled={!canHighlight}
  onClick={() => viewerRef.current?.sendHighlight([{ prim_path: handoff.usdPrimPath, color: "red" }])}
>
  Highlight failed element
</button>
```

Show distinct disabled reasons for: no manual start, no first frame, stage mismatch, missing `usd_prim_path`, and viewer lease conflict.

## Task 6: Verification And E2E

**Files:**
- Modify or create: `web-viewer-sample/tests/a1-review-room.spec.ts`

- [ ] **Step 1: Run focused unit tests**

```powershell
npm test -- A1ViewerEmbed.test.tsx ReviewSessionViewerPane.test.tsx console.test.tsx
```

- [ ] **Step 2: Run build**

```powershell
npm run build
```

- [ ] **Step 3: Browser E2E when services are available**

E2E assertions:

- A1 has no inline WebRTC viewer.
- A1 `Open Review Room` navigates to `#review?source=a1...`.
- Review Room shows `Kit session not started` before manual click.
- Review Room does not call lease claim before manual click.
- After manual attach, first-frame, stage-match, DataChannel, and `highlightPrimsResult` are distinct evidence points.

## Self-Review Checklist

- [ ] A1 no longer renders `EmbeddedViewer`.
- [ ] A1 does not claim viewer lease on mount.
- [ ] A1 does not silently auto-select `act[0]`.
- [ ] Review Room is the dedicated A1 3D handoff target.
- [ ] Kit session attach/start requires explicit user click.
- [ ] Viewer lease token is not in URL.
- [ ] Missing `usd_prim_path` disables highlight.
- [ ] Stale session and no-Kit-runtime are distinguishable from governance failure.
- [ ] Tests fail if embedded viewer is reintroduced into A1.

## Execution Options

Plan complete and saved to `docs/superpowers/plans/2026-07-02-a1-3d-review-decouple.md`.

1. Subagent-Driven (recommended): dispatch a fresh subagent per task, review between tasks, fast iteration.
2. Inline Execution: execute tasks in this session using executing-plans, batch execution with checkpoints.
