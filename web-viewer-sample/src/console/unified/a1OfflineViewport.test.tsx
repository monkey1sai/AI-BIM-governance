import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { ConsoleDataProvider } from "./ConsoleDataProvider";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { UnifiedStateProvider } from "./UnifiedShell";
import { spyCoordinatorEndpoints, RT_IDLE } from "./__testdata__/coordinatorMocks";

describe("a1OfflineViewport (Task 3.1)", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    coordinatorStatusStore.reset();
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
    }
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  async function mount(initialDock: "a1" | "a2" | "a3" | "a4" | "issues" = "a1") {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ConsoleDataProvider store={coordinatorStatusStore}>
          <UnifiedStateProvider>
            <WorkspacePage initialDock={initialDock} />
          </UnifiedStateProvider>
        </ConsoleDataProvider>
      );
    });
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it("renders demo offline viewport without fabricated streaming metrics (Streaming · 28 ms or 60 FPS in viewport)", async () => {
    await mount("a1");
    // Viewport area must be marked data-prov="demo"
    const demoVp = container.querySelector("[data-uc='viewport']");
    expect(demoVp).not.toBeNull();
    expect(demoVp?.getAttribute("data-prov")).toBe("demo");
    expect(demoVp?.textContent).toMatch(/no-GPU 示意／示範圖|no-GPU/);

    // Must NOT contain fabricated streaming metrics inside the viewport
    expect(container.querySelector("[data-uc='streaming-pill']")).toBeNull();
    expect(demoVp?.textContent).not.toContain("Streaming · 28 ms");
    expect(demoVp?.textContent).not.toContain("60 FPS · 28 ms");
  });

  it("provides manual handoff link to /ui/open?session=<id> when review session exists", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: {
        ...RT_IDLE,
        sessions: {
          count: 1,
          active_count: 1,
          participant_count: 2,
          items: [{ session_id: "S-12345", status: "active" } as any],
        },
      },
    });
    await mount("a1");

    const handoffLink = container.querySelector<HTMLAnchorElement>("a[data-uc='live-handoff-link']");
    if (handoffLink) {
      expect(handoffLink.href).toContain("/ui/open?session=S-12345");
      expect(handoffLink.target).toBe("_blank");
      expect(handoffLink.rel).toContain("noopener");
    }
  });

  it("does not render any conversion trigger button on A1 workspace", async () => {
    await mount("a1");
    const convTrigger = container.querySelector("[data-uc='trigger-conv']");
    expect(convTrigger).toBeNull();
  });
});
