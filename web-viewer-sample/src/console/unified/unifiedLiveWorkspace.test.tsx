import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorStatusStore } from "./coordinatorStatusStore";

describe("Unified A1-A4 live workspace routing", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let previousHash: string;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    previousHash = window.location.hash;
    window.location.hash = "#a2";
    coordinatorStatusStore.reset();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline test")));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container.remove();
    window.location.hash = previousHash;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("A2 計算差異留在 #a2，不導向 legacy #version-diff", async () => {
    await act(async () => root?.render(<EdgeConsole />));
    const action = Array.from(container.querySelectorAll<HTMLElement>('button, [role="button"]'))
      .find((node) => /計算差異|Compute diff|Run Diff/i.test(node.textContent ?? ""));
    expect(action).toBeDefined();

    await act(async () => action?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(window.location.hash).toBe("#a2");
  });
});
