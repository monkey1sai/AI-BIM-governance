// WorkspaceViewportHost 交給 pane 的 onSectionInvalidated（docs/architecture/viewport-slot-adr.md 2026-09-24 review 修訂）：
// 不論 pane 以什麼參數呼叫，都讓每個指令 family 與量測一起失效；參數永遠不會被當成 family。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paneCapture = vi.hoisted(() => vi.fn());

vi.mock("../ReviewSessionViewerPane", async () => {
  const { forwardRef } = await import("react");
  return {
    ReviewSessionViewerPane: forwardRef((props: Record<string, unknown>, ref) => {
      void ref;
      paneCapture(props);
      return <div data-testid="viewer-pane-stub" />;
    }),
  };
});

import { ConsoleDataContext } from "./consoleData";
import { CoordinatorStatusStore } from "./coordinatorStatusStore";
import type { EndpointSlice } from "./coordinatorStatusStore";
import { idleFetchers, RT_IDLE } from "./__testdata__/coordinatorMocks";
import { OPEN_GATE } from "./__testdata__/viewerGates";
import { fakeViewerHostActions } from "./__testdata__/viewportSlot";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";
import { useViewportSlot, type ViewportSlotApi } from "./viewportSlot";
import { fakeViewerCommandPort } from "../../viewerCommandChannel/__testdata__/fakeViewerCommandPort";
import type { SectionInput, SectionReply } from "../../viewerCommandChannel/sectionPlane";
import type { OverlayStyleReply } from "../../viewerCommandChannel/overlayStyle";

const SECTION_INPUT: SectionInput = { enabled: true, axis: "z", direction: 1, position: 2 };
const SECTION: SectionReply = { status: "applied", clientRequestId: "c1", requestId: "r1", effective: SECTION_INPUT };
const OVERLAY_PRIM = "/World/Overlays/Cfd/cfd_20260921T070000Z_ui0001/PedestrianWind_1p5m";
const OVERLAY: OverlayStyleReply = { status: "applied", clientRequestId: "c2", requestId: "r2", primPath: OVERLAY_PRIM, displayOpacity: 0.4 };

describe("WorkspaceViewportHost onSectionInvalidated", () => {
  let container: HTMLDivElement, root: Root, store: CoordinatorStatusStore, api: ViewportSlotApi;

  function Probe() { api = useViewportSlot()!; return null; }

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    store = new CoordinatorStatusStore(idleFetchers(), { isHidden: () => true });
    (store as unknown as { publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void }).publish("runtimeStatus",
      { data: RT_IDLE, state: "live", httpStatus: 200, message: null, lastUpdatedAt: Date.now() });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    store.dispose();
    container.remove();
    paneCapture.mockReset();
    vi.restoreAllMocks();
  });

  for (const argument of [undefined, "overlay", new Event("load")]) {
    it(`invalidates every family and the measurement when the pane calls it with ${String(argument)}`, async () => {
      await act(async () => {
        root.render(
          <ConsoleDataContext.Provider value={store}>
            <ViewportSlotProvider><Probe /><WorkspaceViewportHost /></ViewportSlotProvider>
          </ConsoleDataContext.Provider>,
        );
      });
      await act(async () => {
        api.publishViewer({ mode: "a1-inline", handoff: {
          source: "a1", sessionId: "review_session_invalidated", ruleRunId: null, ifcGuid: null, usdPrimPath: null, ruleCode: null,
          severity: null, label: null, expectedStageUrl: null, mappingInformationStatus: null, mappingIssueCode: null,
          mappingIssueCount: null,
        } });
      });
      await act(async () => {
        api.registerHostActions(fakeViewerHostActions({
          commands: fakeViewerCommandPort({ section_plane: async () => SECTION, overlay_style: async () => OVERLAY }),
        }));
        api.setGate(OPEN_GATE);
      });
      await act(async () => {
        await api.commands.send("section_plane", SECTION_INPUT);
        await api.commands.send("overlay_style", { primPath: OVERLAY_PRIM, displayOpacity: 0.4 });
      });
      act(() => { api.setMeasurementState({ status: "result", distanceMetres: 2.3 }); });
      expect(api.commandState("section_plane")).toEqual(SECTION);
      expect(api.commandState("overlay_style")).toEqual(OVERLAY);

      const props = paneCapture.mock.calls[paneCapture.mock.calls.length - 1][0] as { onSectionInvalidated?: (value?: unknown) => void };
      expect(typeof props.onSectionInvalidated).toBe("function");
      act(() => { props.onSectionInvalidated!(argument); });
      expect(api.commandState("section_plane")).toEqual({ status: "unconfirmed" });
      expect(api.commandState("overlay_style")).toEqual({ status: "unconfirmed" });
      expect(api.measurementState).toEqual({ status: "unconfirmed" });
    });
  }
});
