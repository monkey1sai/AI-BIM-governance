// Regression guard for the post-convergence workspace: A1-A4 tabs mount their
// canonical live modules directly. There is no health-gated fixture dock or
// "open full tool" redirect chip anymore.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("workspace direct live modules", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let previousHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    previousHash = window.location.hash;
    spyCoordinatorEndpointsOffline();
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = previousHash;
  });

  async function mountAt(hash: string) {
    window.location.hash = hash;
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
  }

  it("renders A1 live workbench even while backends are unavailable", async () => {
    await mountAt("#a1");
    expect(container.querySelector('[data-uc="unified-live-workspace"]')).not.toBeNull();
    expect(container.textContent).toContain("A1 · 治理與模型檢核");
    expect(container.textContent).toContain("Kit primary WebRTC");
    expect(container.querySelector('[data-testid="dock-live-link"]')).toBeNull();
    expect(container.textContent).not.toContain("rule-run #88");
  });

  it("switches A2-A4 tabs in place without legacy redirect routes", async () => {
    await mountAt("#a1");
    const expectations = [
      ["a2", "模型版本差異與責任追蹤 · A2"],
      ["a3", "跨專業模型 Federation · A3"],
      ["a4", "A4 語意查詢與證據"],
    ] as const;

    for (const [dock, heading] of expectations) {
      await act(async () => {
        container.querySelector(`[data-uc="dock-tab-${dock}"]`)!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(window.location.hash).toBe(`#${dock}`);
      expect(container.querySelector(`[data-uc="live-module-${dock}"]`)).not.toBeNull();
      expect(container.textContent).toContain(heading);
    }
  });
});
