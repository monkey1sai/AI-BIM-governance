import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SharedStatusRail } from "./SharedStatusRail";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { type SharedStatusSnapshot } from "./useSharedStatus";

const base: SharedStatusSnapshot = { activeSessions: 3, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: 2, updatedAt: "2026-07-03T01:00:00Z", stale: false };

function renderRail(container: HTMLElement, value: SharedStatusSnapshot) {
  const root = createRoot(container);
  act(() => { root.render(<SharedStatusProvider value={value}><SharedStatusRail activeAxis="a1" /></SharedStatusProvider>); });
  return root;
}

describe("SharedStatusRail honesty rendering", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); });

  it("shows real active sessions and queue", () => {
    renderRail(container, base);
    expect(container.querySelector('[data-testid="rail-sessions-value"]')?.textContent).toBe("3");
    expect(container.querySelector('[data-testid="rail-queue-value"]')?.textContent).toBe("2");
  });

  it("renders 未取得 for null GPU (not a green light)", () => {
    renderRail(container, base);
    const gpu = container.querySelector('[data-testid="rail-gpu-value"]');
    expect(gpu?.textContent).toContain("未取得");
  });

  it("dims the whole rail and shows 資料過期 when stale", () => {
    renderRail(container, { ...base, stale: true });
    const rail = container.querySelector('[data-testid="shared-status-rail"]');
    expect(rail?.getAttribute("data-stale")).toBe("true");
    expect(rail?.textContent).toContain("資料過期");
  });

  it("shows grey unknown (not ok/fail) when health is unknown", () => {
    renderRail(container, { ...base, health: "unknown" });
    const h = container.querySelector('[data-testid="rail-health-value"]');
    expect(h?.className).toContain("health-unknown");
    expect(h?.textContent).not.toContain("ok");
  });

  it("GPU metric navigates to #instances via handoff", () => {
    renderRail(container, base);
    const btn = container.querySelector('[data-testid="rail-gpu"]') as HTMLButtonElement;
    act(() => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash.startsWith("#instances?source=a1")).toBe(true);
  });
});
