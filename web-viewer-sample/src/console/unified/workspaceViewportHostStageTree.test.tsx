import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const paneCapture = vi.hoisted(() => vi.fn());

vi.mock("../ReviewSessionViewerPane", async () => {
  const { forwardRef } = await import("react");
  return {
    ReviewSessionViewerPane: forwardRef((_props: Record<string, unknown>, ref) => {
      void ref;
      paneCapture(_props);
      return <div data-testid="viewer-pane-stub" />;
    }),
  };
});

import { ConsoleDataContext } from "./consoleData";
import { CoordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointSlice } from "./coordinatorStatusStore";
import { idleFetchers, RT_IDLE } from "./__testdata__/coordinatorMocks";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";
import { useViewportSlot } from "./viewportSlot";
import type { StageTreeMessage, USDPrimNode } from "../EmbeddedViewer";

describe("WorkspaceViewportHost Stage tree production message shape", () => {
  afterEach(() => {
    paneCapture.mockReset();
    vi.restoreAllMocks();
  });

  it("nested prim_path 仍採用 Window.tsx 已合併完成的完整 root tree", async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    const root = createRoot(container);
    const store = new CoordinatorStatusStore(idleFetchers(), { isHidden: () => true });
    const testStore = store as unknown as {
      publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void;
    };
    testStore.publish("runtimeStatus", {
      data: RT_IDLE,
      state: "live",
      httpStatus: 200,
      message: null,
      lastUpdatedAt: Date.now(),
    });

    let api: ReturnType<typeof useViewportSlot> = null;
    function Probe() { api = useViewportSlot(); return null; }

    await act(async () => {
      root.render(
        <ConsoleDataContext.Provider value={store}>
          <ViewportSlotProvider><Probe /><WorkspaceViewportHost /></ViewportSlotProvider>
        </ConsoleDataContext.Provider>,
      );
    });
    await act(async () => {
      api!.publish({
        mode: "a1-inline",
        handoff: {
          source: "a1",
          sessionId: "review_session_tree",
          ruleRunId: null,
          ifcGuid: null,
          usdPrimPath: null,
          ruleCode: null,
          severity: null,
          label: null,
          expectedStageUrl: null,
          mappingInformationStatus: null,
          mappingIssueCode: null,
          mappingIssueCount: null,
        },
      });
    });

    const fullRoot: USDPrimNode[] = [{
      path: "/World/Root",
      name: "Root",
      children: [{ path: "/World/Root/Child", name: "Child" }],
    }];
    const paneProps = paneCapture.mock.calls[paneCapture.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined;
    const onStageTree = paneProps?.onStageTree as ((message: StageTreeMessage) => void) | undefined;
    expect(onStageTree).toBeTypeOf("function");
    await act(async () => {
      onStageTree?.({
        protocol: "vg01",
        type: "stage_tree",
        prim_path: "/World/Root",
        children: fullRoot,
      });
    });

    expect(api!.stageTree).toEqual(fullRoot);
    expect(api!.stageTree[0]?.children?.[0]?.path).toBe("/World/Root/Child");
    expect(api!.stageTree[0]?.children?.[0]?.path).not.toBe("/World/Root");

    await act(async () => { root.unmount(); });
    store.dispose();
    container.remove();
  });
});
