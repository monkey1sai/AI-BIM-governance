import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewerMount } from "./WorkspaceViewerMount";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";
import { CoordinatorStatusStore, type EndpointSlice } from "./coordinatorStatusStore";
import { ConsoleDataContext } from "./consoleData";
import { RT_IDLE, idleFetchers, sessionItem, spyCoordinatorEndpoints } from "./__testdata__/coordinatorMocks";
import { useViewportSlot } from "./viewportSlot";
import type { ViewportSlotApi, WorkspaceViewerPublication } from "./viewportSlot";
import type { ReviewSessionViewerPaneHandle } from "../ReviewSessionViewerPane";

const binding: WorkspaceViewerPublication = {
  mode: "a1-inline", showHandoffActions: true,
  handoff: {
    source: "a1", sessionId: "review_session_persistent", ruleRunId: null,
    ifcGuid: null, usdPrimPath: null, ruleCode: null, severity: null, label: null,
    expectedStageUrl: null, mappingInformationStatus: null, mappingIssueCode: null, mappingIssueCount: null,
  },
};
describe("workspace publication ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  let api: ViewportSlotApi | null;
  function Probe() { api = useViewportSlot(); return null; }
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    api = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function mountProvider() {
    await act(async () => root.render(<ViewportSlotProvider><Probe /></ViewportSlotProvider>));
  }
  it("retained inactive A1 releases only its subscription and restores it without changing session evidence", async () => {
    function Harness({ active }: { active: boolean }) {
      return <ViewportSlotProvider><Probe /><WorkspaceViewerMount active={active} mode="a1-inline" handoff={binding.handoff} /></ViewportSlotProvider>;
    }
    await act(async () => root.render(<Harness active />));
    await act(async () => {
      api!.setGate({ canSend: true, reason: "" });
      api!.setSelectedStagePaths?.(["/World/A"]);
    });
    await act(async () => root.render(<Harness active={false} />));
    expect(api!.dockSubscription).toBeNull();
    expect(api!.viewerPublication).toEqual(binding);
    expect(api!.selectedStagePaths).toEqual(["/World/A"]);
    await act(async () => root.render(<Harness active />));
    expect(api!.dockSubscription).not.toBeNull();
    expect(api!.activeSessionId).toBe(binding.handoff.sessionId);
    expect(api!.gate?.canSend).toBe(true);
  });
  it("Dock unmount drops callbacks/ref without dropping binding, gate or tree", async () => {
    const gate = vi.fn();
    const paneRef = createRef<ReviewSessionViewerPaneHandle>();
    function Harness({ mounted }: { mounted: boolean }) {
      return <ViewportSlotProvider><Probe />{mounted
        ? <WorkspaceViewerMount mode="a1-inline" handoff={binding.handoff} paneRef={paneRef} onBatchGateChange={gate} />
        : null}</ViewportSlotProvider>;
    }
    await act(async () => root.render(<Harness mounted />));
    expect(api!.viewerPublication).toEqual(binding);
    expect(api!.dockSubscription?.paneRef).toBe(paneRef);
    await act(async () => {
      api!.setGate({ canSend: true, reason: "" });
      api!.setStageTree([{ path: "/World/A", name: "A" }]);
    });
    await act(async () => root.render(<Harness mounted={false} />));
    expect(api!.viewerPublication).toEqual(binding);
    expect(api!.dockSubscription).toBeNull();
    expect(api!.publication).toEqual(binding);
    expect(api!.gate?.canSend).toBe(true);
    expect(api!.stageTree).toHaveLength(1);
  });
  it("Host retains the real pre-claim Pane but hides detached Dock actions and refs", async () => {
    const runtimeStatus = {
      ...RT_IDLE,
      sessions: { count: 1, active_count: 1, participant_count: 0, items: [sessionItem(binding.handoff.sessionId)] },
    };
    spyCoordinatorEndpoints({ runtimeStatus });
    const store = new CoordinatorStatusStore(idleFetchers({ runtimeStatus }), { isHidden: () => true });
    const testStore = store as unknown as {
      publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void;
    };
    testStore.publish("runtimeStatus", {
      data: runtimeStatus, state: "live", httpStatus: 200, message: null, lastUpdatedAt: Date.now(),
    });
    const gate = vi.fn();
    const paneRef = createRef<ReviewSessionViewerPaneHandle>();
    async function flush() {
      for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
    }
    function Harness({ mounted }: { mounted: boolean }) {
      return <ConsoleDataContext.Provider value={store}>
        <ViewportSlotProvider><Probe /><WorkspaceViewportHost />{mounted
          ? <WorkspaceViewerMount mode="a1-inline" handoff={binding.handoff} paneRef={paneRef} onBatchGateChange={gate} />
          : null}</ViewportSlotProvider>
      </ConsoleDataContext.Provider>;
    }
    await act(async () => root.render(<Harness mounted />));
    await flush();
    const input = container.querySelector<HTMLInputElement>('[data-testid="a1-inline-session-input"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe(binding.handoff.sessionId);
    expect(container.querySelector('[data-testid="a1-inline-handoff-summary"]')).not.toBeNull();
    expect(paneRef.current).not.toBeNull();
    await act(async () => root.render(<Harness mounted={false} />));
    await flush();
    // Real Pane input identity is not proof of an active iframe or lease.
    expect(container.querySelector('[data-testid="a1-inline-session-input"]')).toBe(input);
    expect(input!.value).toBe(binding.handoff.sessionId);
    expect(container.querySelector('[data-testid="a1-inline-handoff-summary"]')).toBeNull();
    expect(paneRef.current).toBeNull();
    const detachedGateCalls = gate.mock.calls.length;
    await act(async () => api!.setActiveSessionId(""));
    await flush();
    expect(input!.value).toBe("");
    expect(gate).toHaveBeenCalledTimes(detachedGateCalls);
    expect(paneRef.current).toBeNull();
  });
  it("reattached Dock receives retained ready gate without a new viewer transition", async () => {
    function Dock() {
      const [ready, setReady] = useState(false);
      return <>
        <WorkspaceViewerMount mode="a1-inline" handoff={binding.handoff} onBatchGateChange={(gate) => setReady(gate.canSend)} />
        <button data-testid="dock-apply" disabled={!ready}>Apply</button>
      </>;
    }
    function Harness({ mounted }: { mounted: boolean }) {
      return <ViewportSlotProvider><Probe />{mounted ? <Dock /> : null}</ViewportSlotProvider>;
    }
    await act(async () => root.render(<Harness mounted />));
    await act(async () => api!.setGate({ canSend: true, reason: "", canSendViewerCommand: true, viewerCommandReason: "" }));
    await act(async () => root.render(<Harness mounted={false} />));
    expect(api!.gate?.canSend).toBe(true);
    await act(async () => root.render(<Harness mounted />));
    expect(container.querySelector<HTMLButtonElement>('[data-testid="dock-apply"]')!.disabled).toBe(false);
  });
  it("subscription after explicit session clear never replays a stale ready gate", async () => {
    await mountProvider();
    const callback = vi.fn();
    await act(async () => {
      api!.publishViewer(binding);
      api!.setGate({ canSend: true, reason: "" });
      api!.setActiveSessionId("");
      api!.subscribeDock({ onBatchGateChange: callback });
    });
    expect(api!.gate).toBeNull();
    expect(callback).not.toHaveBeenCalled();
  });
  it("stale disposer cannot remove newer subscription", async () => {
    await mountProvider();
    const oldGate = vi.fn(), newGate = vi.fn();
    let disposeOld!: () => void, disposeNew!: () => void;
    await act(async () => {
      api!.publishViewer(binding);
      disposeOld = api!.subscribeDock({ onBatchGateChange: oldGate });
      disposeNew = api!.subscribeDock({ onBatchGateChange: newGate });
    });
    await act(async () => disposeOld());
    api!.dockSubscription?.onBatchGateChange?.({ canSend: true, reason: "" });
    expect(oldGate).not.toHaveBeenCalled();
    expect(newGate).toHaveBeenCalledTimes(1);
    await act(async () => disposeNew());
    expect(api!.dockSubscription).toBeNull();
    expect(api!.viewerPublication).toEqual(binding);
  });
  it("explicit clear remains authoritative after stale handoff is published", async () => {
    await mountProvider();
    await act(async () => api!.publishViewer(binding));
    await act(async () => api!.setActiveSessionId(""));
    await act(async () => api!.publishViewer(binding));
    expect(api!.activeSessionId).toBe("");
    // Raw handoff metadata can remain; Host must project activeSessionId, never revive it.
    expect(api!.viewerPublication?.handoff.sessionId).toBe(binding.handoff.sessionId);
    expect(api!.gate).toBeNull();
    expect(api!.stageTree).toEqual([]);
  });
  it("legacy null cannot detach a newer owned subscription", async () => {
    await mountProvider();
    const latest = vi.fn();
    await act(async () => {
      api!.publish({ ...binding, onBatchGateChange: vi.fn() });
      api!.subscribeDock({ onBatchGateChange: latest });
      api!.publish(null);
    });
    expect(api!.dockSubscription?.onBatchGateChange).toBe(latest);
    expect(api!.viewerPublication).toEqual(binding);
  });
  it("legacy null detaches its own callback while preserving valid viewing state", async () => {
    await mountProvider();
    await act(async () => {
      api!.publish({ ...binding, onBatchGateChange: vi.fn() });
      api!.setGate({ canSend: true, reason: "" });
      api!.setStageTree([{ path: "/World/A", name: "A" }]);
    });
    await act(async () => api!.publish(null));
    expect(api!.dockSubscription).toBeNull();
    expect(api!.publication).toEqual(binding);
    expect(api!.gate?.canSend).toBe(true);
    expect(api!.stageTree).toHaveLength(1);
  });
});
