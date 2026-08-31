import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apps } from "./fixtures";
import { A1A10 } from "../data";
import { UnifiedShell } from "./UnifiedShell";
import { HomePage } from "./HomePage";

describe("dockBadgeProv (Task 2.3)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    document.body.removeChild(container);
  });

  it("apps in fixtures.ts match A1A10.prov from data.ts and contain no literal LIVE", () => {
    for (const app of apps) {
      const canonical = A1A10.find((a) => a.code === app.code);
      expect(canonical).toBeDefined();
      expect(app.badge).not.toBe("LIVE");
      if (canonical?.prov === "asbuilt") {
        expect(app.badge).toBe("asbuilt");
        expect(app.tone).toBe("asbuilt");
      } else if (canonical?.prov === "p3") {
        expect(app.badge).toBe("P3");
        expect(app.tone).toBe("p3");
      } else if (canonical?.prov === "p4") {
        expect(app.badge).toBe("P4");
        expect(app.tone).toBe("p4");
      }
    }
  });

  it("UnifiedShell sidebar renders canonical badges without literal LIVE", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<UnifiedShell page="home" />);
    });
    expect(container.textContent).not.toContain("LIVE");
    const asbuiltElements = Array.from(container.querySelectorAll("span")).filter(
      (el) => el.textContent === "asbuilt"
    );
    expect(asbuiltElements.length).toBeGreaterThanOrEqual(4);
  });

  it("HomePage launcher renders canonical badges without literal LIVE", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <UnifiedShell page="home">
          <HomePage />
        </UnifiedShell>
      );
    });
    expect(container.textContent).not.toContain("LIVE");
  });
});
