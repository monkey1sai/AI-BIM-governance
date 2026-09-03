import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { ConsoleDataProvider } from "./ConsoleDataProvider";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { UnifiedStateProvider } from "./UnifiedShell";
import { spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

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

  it("renders the live A1 workbench without any demo viewport or fabricated streaming status", async () => {
    spyCoordinatorEndpointsOffline();
    await mount("a1");
    const demoVp = container.querySelector("[data-uc='viewport']");
    expect(demoVp).toBeNull();
    expect(container.textContent).toContain("A1 · 治理與模型檢核");
    expect(container.querySelector("[data-uc='streaming-pill']")).toBeNull();
    expect(container.textContent).not.toContain("openedStageResult ✓");
    expect(container.textContent).not.toContain("no-GPU 示意");
  });

  it("does not auto-attach an unrelated runtime session before a real A1 rule result exists", async () => {
    spyCoordinatorEndpointsOffline();
    await mount("a1");
    expect(container.querySelector("[data-testid='a1-inline-manual-start']")).toBeNull();
    expect(container.querySelector("[data-testid='a1-inline-highlight']")).toBeNull();
  });

  it("does not render any conversion trigger button on A1 workspace", async () => {
    await mount("a1");
    const convTrigger = container.querySelector("[data-uc='trigger-conv']");
    expect(convTrigger).toBeNull();
  });
});
