import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePage } from "./WorkspacePage";
import { ViewportSlotContext, type ViewportSlotApi } from "./viewportSlot";
import { useUsdStageTree } from "../../hooks/useUsdStageTree";

async function flush(n = 6) {
  for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); });
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

    const mockSlotApi: ViewportSlotApi = {
      registerSlot: vi.fn(),
      slotEl: null,
      publish: vi.fn(),
      publication: null,
      activeSessionId: "session_test_123",
      setActiveSessionId: vi.fn(),
      gate: { canSend: true, reason: "" },
      setGate: vi.fn(),
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
      setStageTree: vi.fn(),
      requestStageTree: requestStageTreeMock,
      selectPrim: selectPrimMock,
      sendToolbarAction: sendToolbarActionMock,
      registerHostActions: vi.fn(),
    };

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
    expect(stageTreeAside?.getAttribute("aria-disabled")).toBe("false");

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
    await act(async () => { expandToggle?.click(); });
    expect(requestStageTreeMock).toHaveBeenCalledWith("/World/Structure");

    // 點擊工具列按鈕
    const resetBtn = container.querySelector('[data-testid="ws-toolbar-reset"]') as HTMLButtonElement | null;
    expect(resetBtn?.disabled).toBe(false);
    await act(async () => {
      resetBtn?.click();
    });
    expect(sendToolbarActionMock).toHaveBeenCalledWith("reset_camera");
    expect(item?.getAttribute("data-selected")).toBe("false");

    const camBtn = container.querySelector('[data-testid="ws-toolbar-camera-view"]') as HTMLButtonElement | null;
    expect(camBtn?.disabled).toBe(true);
    await act(async () => {
      camBtn?.click();
    });
    expect(sendToolbarActionMock).not.toHaveBeenCalledWith("camera_view", "perspective");

    selectPrimMock.mockClear();
    requestStageTreeMock.mockClear();
    await act(async () => {
      root!.render(
        <ViewportSlotContext.Provider value={{ ...mockSlotApi, gate: { canSend: false, reason: "viewer disconnected" } }}>
          <WorkspacePage initialDock="a1" />
        </ViewportSlotContext.Provider>,
      );
    });
    const blockedTree = container.querySelector('[data-uc="ws-stage-tree"]');
    expect(blockedTree?.getAttribute("data-state")).toBe("blocked");
    await act(async () => { item?.click(); expandToggle?.click(); });
    expect(selectPrimMock).not.toHaveBeenCalled();
    expect(requestStageTreeMock).not.toHaveBeenCalled();
  });
});
