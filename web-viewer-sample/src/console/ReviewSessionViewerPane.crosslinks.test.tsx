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

  // 誠實鐵律 / N5：sessionsById（spec §5.2）是全量表（不分狀態，coordinator 從不刪除 session：
  // active→closing→closed 永久保留）。datalist 是「可 attach 候選」（spec §5.5），只能列本 pane 的
  // runtimeSessions 判定為可 attach 的狀態集（active/created，比照 ReviewSessionViewerPane.tsx:123 與
  // sessionObserved/claimPrimary 的手動啟動 gate），否則長壽環境累積的 closed/closing 過期 session 會被
  // 當成外觀無異的自動完成候選，選到才在按下手動啟動時發現 disabled——把過期 session 假裝成可 attach。
  it("seeds the datalist only from attachable (active/created) sessions; closed/closing are excluded", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue({ sessions: { items: [] }, configured_endpoints: { viewer: { browser_url_base: "" }, coordinator: { public_base_url: "" } } } as never);
    const mixed: SharedStatusSnapshot = { ...snap, activeSessions: 1, sessionsById: {
      review_session_active: { session_id: "review_session_active", status: "active" },
      review_session_created: { session_id: "review_session_created", status: "created" },
      review_session_closed: { session_id: "review_session_closed", status: "closed" },
      review_session_closing: { session_id: "review_session_closing", status: "closing" },
    } };
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider value={mixed}><ReviewSessionViewerPane handoff={{ source: "sessions", sessionId: "", ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null, expectedStageUrl: null }} /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });

    const datalist = container.querySelector('[data-testid="review-room-session-candidates"]');
    // active/created = 可 attach（與 runtimeSessions 的手動啟動 gate 一致）→ 應為候選
    expect(datalist?.querySelector('option[value="review_session_active"]')).not.toBeNull();
    expect(datalist?.querySelector('option[value="review_session_created"]')).not.toBeNull();
    // closed/closing = 過期不可 attach → 不得混入候選（N5：不假裝成可操作）
    expect(datalist?.querySelector('option[value="review_session_closed"]')).toBeNull();
    expect(datalist?.querySelector('option[value="review_session_closing"]')).toBeNull();
    expect(datalist?.querySelectorAll("option").length).toBe(2);
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
