import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refusedViewerGate } from "../viewerGate";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { fakeViewerHostActions, fakeViewportSlot } from "./__testdata__/viewportSlot";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotContext, type ViewportSlotApi } from "./viewportSlot";
import { useUsdStageTree } from "../../hooks/useUsdStageTree";

async function flush(n = 6) {
  for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); });
}

/** 本頁的 Stage 樹選取只在 slot 沒有 Kit 回報的選取時顯示本地狀態；這些測試刻意不帶 selectedStagePaths 來觀察本地選取。 */
function slotWithoutKitSelection(overrides: Partial<ViewportSlotApi>): ViewportSlotApi {
  return { ...fakeViewportSlot(overrides), selectedStagePaths: undefined } as unknown as ViewportSlotApi;
}

describe("useUsdStageTree hook (Issue #609, #603)", () => {
  it("支援階層樹載入、搜尋過濾、節點展開與自訂色彩 (setPrimColor)", () => {
    let hook: ReturnType<typeof useUsdStageTree> = null!;
    function TestComponent() {
      hook = useUsdStageTree({
        initialPrims: [
          {
            path: "/World",
            name: "World",
            children: [
              { path: "/World/Building", name: "Building", type: "Xform", children: [
                { path: "/World/Building/Wall_01", name: "Wall_01", type: "Mesh" },
                { path: "/World/Building/Slab_01", name: "Slab_01", type: "Mesh" },
              ]},
            ],
          },
        ],
      });
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => { root.render(<TestComponent />); });

    expect(hook.usdPrims.length).toBe(1);
    expect(hook.filteredPrims.length).toBe(1);

    // 搜尋過濾
    act(() => { hook.setSearchQuery("Wall"); });
    expect(hook.filteredPrims.length).toBe(1);
    expect(hook.filteredPrims[0].children?.[0].children?.length).toBe(1);
    expect(hook.filteredPrims[0].children?.[0].children?.[0].name).toBe("Wall_01");

    // 多色高亮 (Issue #603)
    act(() => { hook.setPrimColor("/World/Building/Wall_01", [1, 0, 0, 0.8]); });
    expect(hook.customColors["/World/Building/Wall_01"]).toEqual([1, 0, 0, 0.8]);

    act(() => { root.unmount(); });
  });
});

describe("WorkspacePage Stage 樹與工具列整合 (Issue #609, #605)", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  it("當 slot 提供 stageTree 時，左欄轉為 active 狀態並顯示搜尋框與節點", async () => {
    const selectPrimMock = vi.fn();
    const sendToolbarActionMock = vi.fn();
    const requestStageTreeMock = vi.fn();

    const slotValues: Partial<ViewportSlotApi> = {
      activeSessionId: "session_test_123",
      stageTree: [
        {
          path: "/World",
          name: "World",
          children: [
            // Production Kit uses children: [] as the lazy-branch marker.
            { path: "/World/Structure", name: "Structure", type: "Xform", children: [] },
            { path: "/World/Leaf", name: "Leaf", type: "Mesh" },
          ],
        },
      ],
      hostActions: fakeViewerHostActions({
        requestStageTree: requestStageTreeMock,
        selectPrim: selectPrimMock,
        sendToolbarAction: sendToolbarActionMock,
      }),
    };
    const mockSlotApi = slotWithoutKitSelection({ ...slotValues, gate: OPEN_GATE });

    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ViewportSlotContext.Provider value={mockSlotApi}>
          <WorkspacePage initialDock="a1" />
        </ViewportSlotContext.Provider>,
      );
    });
    await flush();

    const stageTreeAside = container.querySelector('[data-uc="ws-stage-tree"]');
    expect(stageTreeAside?.getAttribute("data-state")).toBe("active");
    // The container includes independent section/measurement tools. Only each
    // individual control may be disabled; no inherited container-wide state.
    expect(stageTreeAside?.hasAttribute("aria-disabled")).toBe(false);

    const searchInput = container.querySelector('[data-uc="ws-stage-search"]') as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();

    // 點擊節點觸發 selectPrim
    const item = container.querySelector('[data-path="/World/Structure"]') as HTMLElement | null;
    expect(item).not.toBeNull();
    await act(async () => {
      item?.click();
    });
    expect(selectPrimMock).toHaveBeenCalledWith("/World/Structure");

    const expandToggle = container.querySelector('[data-testid="expand-toggle-/World/Structure"]') as HTMLElement | null;
    expect(expandToggle).not.toBeNull();
    expect(container.querySelector('[data-testid="expand-toggle-/World/Leaf"]')).toBeNull();

    const refreshButton = container.querySelector('[data-testid="ws-request-stage-tree-btn"]') as HTMLButtonElement | null;
    expect(refreshButton?.disabled).toBe(false);
    await act(async () => { refreshButton?.click(); });
    expect(requestStageTreeMock).toHaveBeenCalledWith("/World");
    requestStageTreeMock.mockClear();

    await act(async () => { expandToggle?.click(); });
    expect(requestStageTreeMock).toHaveBeenCalledWith("/World/Structure");
    await act(async () => { expandToggle?.click(); });
    expect(requestStageTreeMock).toHaveBeenCalledTimes(1);

    // 點擊工具列按鈕
    const resetBtn = container.querySelector('[data-testid="ws-toolbar-reset"]') as HTMLButtonElement | null;
    expect(resetBtn?.disabled).toBe(false);
    await act(async () => {
      resetBtn?.click();
    });
    expect(sendToolbarActionMock).toHaveBeenCalledWith("reset_camera");
    expect(item?.getAttribute("data-selected")).toBe("false");
    expect(resetBtn?.textContent).toContain("建築主體");
    const frameAllBtn = container.querySelector('[data-testid="ws-toolbar-frame-all"]') as HTMLButtonElement;
    expect(frameAllBtn.disabled).toBe(false);
    await act(async () => { frameAllBtn.click(); });
    expect(sendToolbarActionMock).toHaveBeenCalledWith("frame_all");

    const camBtn = container.querySelector('[data-testid="ws-toolbar-camera-view"]') as HTMLButtonElement | null;
    expect(camBtn?.disabled).toBe(false);
    await act(async () => {
      camBtn?.click();
    });
    expect(sendToolbarActionMock).not.toHaveBeenCalledWith("camera_view", "perspective");

    selectPrimMock.mockClear();
    requestStageTreeMock.mockClear();
    await act(async () => {
      root!.render(
        <ViewportSlotContext.Provider value={slotWithoutKitSelection({ ...slotValues, gate: refusedViewerGate("waiting_datachannel") })}>
          <WorkspacePage initialDock="a1" />
        </ViewportSlotContext.Provider>,
      );
    });
    const blockedTree = container.querySelector('[data-uc="ws-stage-tree"]');
    expect(blockedTree?.getAttribute("data-state")).toBe("blocked");
    const blockedRefreshButton = container.querySelector('[data-testid="ws-request-stage-tree-btn"]') as HTMLButtonElement | null;
    const blockedSearchInput = container.querySelector('[data-uc="ws-stage-search"]') as HTMLInputElement | null;
    expect(blockedRefreshButton?.disabled).toBe(true);
    expect(blockedSearchInput?.disabled).toBe(true);
    expect(resetBtn?.disabled).toBe(true);
    expect(frameAllBtn.disabled).toBe(true);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(blockedSearchInput, "Leaf");
      blockedSearchInput?.dispatchEvent(new Event("input", { bubbles: true }));
      item?.click();
      expandToggle?.click();
      blockedRefreshButton?.click();
    });
    expect(container.querySelector('[data-path="/World/Structure"]')).not.toBeNull();
    expect(selectPrimMock).not.toHaveBeenCalled();
    expect(requestStageTreeMock).not.toHaveBeenCalled();
  });

  it("stageTree 轉空後清除舊節點與本地搜尋、展開、選取狀態", async () => {
    const tree = [{
      path: "/World",
      name: "World",
      children: [
        { path: "/World/Structure", name: "Structure", type: "Xform", children: [] },
        { path: "/World/Leaf", name: "Leaf", type: "Mesh" },
      ],
    }];
    const hostActions = fakeViewerHostActions();
    const baseSlot = slotWithoutKitSelection({ activeSessionId: "session_test_123", gate: OPEN_GATE, stageTree: tree, hostActions });

    const renderWithTree = async (stageTree: ViewportSlotApi["stageTree"]) => {
      await act(async () => {
        root ??= createRoot(container);
        root.render(
          <ViewportSlotContext.Provider value={{ ...baseSlot, stageTree }}>
            <WorkspacePage initialDock="a1" />
          </ViewportSlotContext.Provider>,
        );
      });
      await flush();
    };

    await renderWithTree([]);
    expect(container.querySelector('[data-uc="ws-stage-tree"]')?.getAttribute("data-state")).toBe("waiting");
    const initialRefresh = container.querySelector('[data-testid="ws-request-stage-tree-btn"]') as HTMLButtonElement;
    expect(initialRefresh.disabled).toBe(false);
    await act(async () => { initialRefresh.click(); });
    expect(hostActions.requestStageTree).toHaveBeenCalledTimes(1);
    expect(hostActions.requestStageTree).toHaveBeenCalledWith("/World");

    await renderWithTree(tree);
    const search = container.querySelector('[data-uc="ws-stage-search"]') as HTMLInputElement;
    const structure = container.querySelector('[data-path="/World/Structure"]') as HTMLElement;
    const structureToggle = container.querySelector('[data-testid="expand-toggle-/World/Structure"]') as HTMLElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(search, "Structure");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      structure.click();
      structureToggle.click();
    });
    expect(structure.getAttribute("data-selected")).toBe("true");
    expect(structureToggle.textContent).toBe("▾");

    await renderWithTree([]);
    expect(container.querySelector('[data-path="/World/Structure"]')).toBeNull();
    expect(container.querySelector('[data-uc="ws-stage-search"]')).toBeNull();
    expect(container.querySelector('[data-uc="ws-stage-tree"]')?.getAttribute("data-state")).toBe("waiting");
    const bootstrapRefresh = container.querySelector('[data-testid="ws-request-stage-tree-btn"]') as HTMLButtonElement;
    expect(bootstrapRefresh.disabled).toBe(false);
    vi.mocked(hostActions.requestStageTree).mockClear();
    await act(async () => { bootstrapRefresh.click(); });
    expect(hostActions.requestStageTree).toHaveBeenCalledTimes(1);
    expect(hostActions.requestStageTree).toHaveBeenCalledWith("/World");

    await renderWithTree(tree);
    const restoredSearch = container.querySelector('[data-uc="ws-stage-search"]') as HTMLInputElement;
    const restoredStructure = container.querySelector('[data-path="/World/Structure"]') as HTMLElement;
    const restoredToggle = container.querySelector('[data-testid="expand-toggle-/World/Structure"]') as HTMLElement;
    expect(restoredSearch.value).toBe("");
    expect(restoredStructure.getAttribute("data-selected")).toBe("false");
    expect(restoredToggle.textContent).toBe("▸");
  });
});
