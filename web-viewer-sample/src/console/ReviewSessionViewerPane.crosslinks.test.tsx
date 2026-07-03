// web-viewer-sample/src/console/ReviewSessionViewerPane.crosslinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewSessionViewerPane, parseReviewRoomHandoff } from "./ReviewSessionViewerPane";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { coordinatorClient } from "./coordinatorClient";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const snap: SharedStatusSnapshot = { activeSessions: 1, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "", stale: false };

describe("Review Room session candidate seeding (additive, N3-safe)", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders a datalist of shared-status sessions and keeps the input free-text; no lease claim on mount", async () => {
    const claimSpy = vi.spyOn(coordinatorClient, "claimViewerLease");
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [] }, configured_endpoints: { viewer: { browser_url_base: "" }, coordinator: { public_base_url: "" } } } as never);
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider value={snap}><ReviewSessionViewerPane handoff={{ source: "sessions", sessionId: "", ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null, expectedStageUrl: null }} /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });

    const datalist = container.querySelector('[data-testid="review-room-session-candidates"]');
    expect(datalist).not.toBeNull();
    expect(datalist?.querySelector('option[value="review_session_a"]')).not.toBeNull();
    const input = container.querySelector('[data-testid="review-room-session-input"]');
    expect(input?.getAttribute("list")).toBe("review-room-session-candidates");
    expect(claimSpy).not.toHaveBeenCalled(); // N3: no auto-claim
  });

  // The new §4.3 chips send source=conv/sessions/intake/runtime to #review. Prove the EXISTING Review Room
  // parser (parseReviewRoomHandoff, ReviewSessionViewerPane.tsx:31) accepts non-a1 sources — it reads the
  // same snake_case URL keys and does not gate on source value — so these chips are actually consumed, not
  // silently dropped. (Without this, "#review works" was only ever verified for source=a1.)
  it("accepts non-a1 handoff sources so CV/SS/IN/RT → #review chips are actually consumed", () => {
    for (const source of ["conv", "sessions", "intake", "runtime"]) {
      const parsed = parseReviewRoomHandoff(`#review?source=${source}&session=review_session_a`);
      expect(parsed.source).toBe(source);
      expect(parsed.sessionId).toBe("review_session_a");
    }
  });
});
