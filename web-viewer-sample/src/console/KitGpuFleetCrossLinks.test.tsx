// web-viewer-sample/src/console/KitGpuFleetCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitGpuFleetPage } from "./pages";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const snap: SharedStatusSnapshot = { activeSessions: 2, sessionsById: { review_session_a: { session_id: "review_session_a", status: "active" }, review_session_b: { session_id: "review_session_b", status: "active" } }, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };

describe("KG real aggregate + demo separation", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); window.location.hash = ""; });
  afterEach(() => { document.body.removeChild(container); window.location.hash = ""; });

  it("shows a real session aggregate (asbuilt) and keeps the demo table as demo", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("2");
    // demo table still present and still labeled demo (Node snapshot panel), not faked as real
    expect(container.textContent).toContain("edge-gpu-01");
    expect(container.querySelector('[data-testid="kg-demo-link-sessions"]')).not.toBeNull();
  });

  it("navigates demo row chip to #sessions?source=instances (no session id on the static demo row)", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const chip = container.querySelector('[data-testid="kg-demo-link-sessions"]') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    act(() => { chip.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=instances");
  });

  it("renders per-session live links that navigate to #sessions carrying the real session id", () => {
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>); });
    const live = container.querySelector('[data-testid="kg-session-link-review_session_a"]') as HTMLButtonElement;
    expect(live).not.toBeNull();
    act(() => { live.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#sessions?source=instances");
    expect(window.location.hash).toContain("session=review_session_a");
  });

  it("shows an honest empty state when there are no active sessions (no fake aggregate)", () => {
    const empty: SharedStatusSnapshot = { ...snap, activeSessions: 0, sessionsById: {} };
    const root = createRoot(container);
    act(() => { root.render(<SharedStatusProvider value={empty}><KitGpuFleetPage /></SharedStatusProvider>); });
    const agg = container.querySelector('[data-testid="kg-live-aggregate"]');
    expect(agg?.textContent).toContain("0");
    expect(container.querySelector('[data-testid^="kg-session-link-"]')).toBeNull();
  });
});
