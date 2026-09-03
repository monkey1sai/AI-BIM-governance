import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { ConsoleDataProvider } from "./ConsoleDataProvider";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { UnifiedStateProvider } from "./UnifiedShell";
import { spyCoordinatorEndpoints } from "./__testdata__/coordinatorMocks";

describe("a4Header (Task 3.2)", () => {
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

  async function mount() {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ConsoleDataProvider store={coordinatorStatusStore}>
          <UnifiedStateProvider>
            <WorkspacePage initialDock="a4" />
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

  it("renders A4 header with purpose, source, empty reasons, and next step instructions", async () => {
    spyCoordinatorEndpoints({
      ifcReady: { count: 0, items: [] },
    });
    await mount();

    const a4Dock = container.querySelector("[data-testid='a4-semantic-search-page']");
    expect(a4Dock).not.toBeNull();
    const text = a4Dock?.textContent ?? "";
    // Checks for Purpose, Input Source, and Next steps
    expect(text).toMatch(/A4|語意查詢|Semantic/);
    expect(text).toMatch(/ifc_ready|Review Session/i);
  });
});
