import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, type ViewerLeaseClaimResponse } from "../coordinatorClient";
import { __resetLocalDevUserCarrierForTests } from "../localDevPrincipal";
import { ConsoleDataContext } from "./consoleData";
import { CoordinatorStatusStore, type EndpointSlice } from "./coordinatorStatusStore";
import { idleFetchers, RT_IDLE, sessionItem, spyCoordinatorEndpoints } from "./__testdata__/coordinatorMocks";
import { ViewportSlotProvider } from "./ViewportSlotProvider";
import { WorkspaceViewportHost } from "./WorkspaceViewportHost";
import { WorkspaceViewerMount } from "./WorkspaceViewerMount";
import { useViewportSlot, type ViewportSlotApi, type WorkspaceViewerMode } from "./viewportSlot";
import type { ReviewRoomHandoff } from "../ReviewSessionViewerPane";

// Real Host, Pane and EmbeddedViewer DOM; only Coordinator is a test double.
// This proves client ownership, not a live Kit, media stream or actual lease.
const sessionId = "review_session_ownership";
const handoff: ReviewRoomHandoff = {
  source: "a1", sessionId, ruleRunId: null, ifcGuid: null, usdPrimPath: null,
  ruleCode: null, severity: null, label: null, expectedStageUrl: "http://127.0.0.1:8004/artifacts/model.usdc",
  mappingInformationStatus: null, mappingIssueCode: null, mappingIssueCount: null,
};
const lease: ViewerLeaseClaimResponse = {
  lease_id: "test_lease_ownership", lease_token: "synthetic_test_token",
  session_id: sessionId, viewer_id: "test_viewer", user_id: "test_operator",
  display_name: "Test operator", role: "primary", status: "active",
  kit_instance_id: "kit_test", stream_config: {
    signalingServer: "127.0.0.1", signalingPort: 49100,
    mediaServer: "127.0.0.1", mediaPort: 47998,
  },
  client_nonce: "test_nonce", claimed_at: "2026-09-08T00:00:00Z",
  expires_at: "2030-01-01T00:00:00Z", last_heartbeat_at: null,
  released_at: null, first_frame_at: null, loaded_stage_url: null,
  datachannel_ready: false, stage_match: null, primary: true,
  heartbeat_after_ms: 15000, idempotent_replay: false,
};

describe("Workspace iframe Stage tree lifecycle (controlled messages)", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let store: CoordinatorStatusStore;
  let api: ViewportSlotApi | null;
  let previousAct: unknown;
  function Probe() { api = useViewportSlot(); return null; }
  function Harness({ dock }: { dock: WorkspaceViewerMode | null }) {
    return <ConsoleDataContext.Provider value={store}>
      <ViewportSlotProvider><Probe /><WorkspaceViewportHost />
        {dock ? <WorkspaceViewerMount key={dock} mode={dock} handoff={handoff} /> : null}
      </ViewportSlotProvider>
    </ConsoleDataContext.Provider>;
  }
  async function flush() {
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  }
  async function render(dock: WorkspaceViewerMode | null) {
    await act(async () => { root!.render(<Harness dock={dock} />); });
    await flush();
  }
  async function start() {
    await render("a1-inline");
    const button = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-manual-start"]');
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(false);
    await act(async () => { button!.click(); });
    await flush();
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    return iframe!;
  }
  beforeEach(() => {
    previousAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    __resetLocalDevUserCarrierForTests();
    api = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const runtimeStatus = {
      ...RT_IDLE,
      sessions: { count: 1, active_count: 1, participant_count: 0, items: [sessionItem(sessionId)] },
    };
    spyCoordinatorEndpoints({ runtimeStatus });
    vi.spyOn(coordinatorClient, "streamConfig").mockResolvedValue({ session_id: sessionId, status: "active", trace_id: "test_trace_ownership" });
    vi.spyOn(coordinatorClient, "claimViewerLease").mockResolvedValue(lease);
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockResolvedValue(lease);
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockResolvedValue(lease);
    store = new CoordinatorStatusStore(idleFetchers({ runtimeStatus }), { isHidden: () => true });
    (store as unknown as { publish: (key: "runtimeStatus", slice: EndpointSlice<typeof RT_IDLE>) => void }).publish("runtimeStatus", {
      data: runtimeStatus, state: "live", httpStatus: 200, message: null, lastUpdatedAt: Date.now(),
    });
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    store.dispose();
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = previousAct;
  });
  const tree = [{ path: "/World", name: "World", children: [{ path: "/World/Wall", name: "Wall" }] }];
  async function message(source: Window | null, data: Record<string, unknown>, origin = "http://127.0.0.1:5173") {
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", { origin, source, data: { protocol: "vg01", ...data } }));
    });
    await flush();
  }
  async function publishTree(iframe: HTMLIFrameElement) {
    await message(iframe.contentWindow, { type: "stage_tree", prim_path: "/World", children: tree });
  }
  it("retains the current tree and iframe through A1-A4 Dock replacement without reclaim", async () => {
    const iframe = await start();
    await publishTree(iframe);
    expect(api!.stageTree).toEqual(tree);
    await render(null);
    for (const dock of ["a2-overlay", "a3-inline", "a4-inline", "a1-inline"] as const) {
      await render(dock);
      expect(container.querySelector("iframe")).toBe(iframe);
      expect(api!.stageTree).toEqual(tree);
    }
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalled();
  });
  it("clears the tree on session clear and ignores the old iframe after the same session is reselected", async () => {
    const previous = await start();
    const previousWindow = previous.contentWindow;
    await publishTree(previous);
    expect(api!.stageTree).toEqual(tree);
    await act(async () => { api!.setActiveSessionId(""); });
    await flush();
    expect(api!.stageTree).toEqual([]);
    expect(container.querySelector("iframe")).toBeNull();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    await act(async () => { api!.setActiveSessionId(sessionId); });
    await flush();
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValueOnce({
      ...lease, lease_id: "test_tree_reselected", lease_token: "synthetic_tree_reselected",
    });
    const current = await start();
    expect(current).not.toBe(previous);
    await message(previousWindow, { type: "stage_tree", prim_path: "/World", children: tree });
    expect(api!.stageTree).toEqual([]);
    await publishTree(current);
    expect(api!.stageTree).toEqual(tree);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
  });
  it("clears the tree when Stage proof is withdrawn without replacing the iframe or lease", async () => {
    const iframe = await start();
    await message(iframe.contentWindow, { type: "first_frame", stageUrl: handoff.expectedStageUrl });
    await message(iframe.contentWindow, { type: "stage_loaded", stageUrl: handoff.expectedStageUrl, status: "active" });
    expect(api!.gate?.canSendViewerCommand).toBe(true);
    await publishTree(iframe);
    expect(api!.stageTree).toEqual(tree);
    await message(iframe.contentWindow, { type: "stage_loaded", stageUrl: null, status: "unproven" });
    expect(api!.gate?.canSendViewerCommand).toBe(false);
    expect(api!.stageTree).toEqual([]);
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalled();
  });
  it("rejects Stage tree messages from a wrong origin or a different window", async () => {
    const iframe = await start();
    await message(iframe.contentWindow, { type: "stage_tree", prim_path: "/World", children: tree }, "https://untrusted.invalid");
    expect(api!.stageTree).toEqual([]);
    await message(window, { type: "stage_tree", prim_path: "/World", children: tree });
    expect(api!.stageTree).toEqual([]);
    await publishTree(iframe);
    expect(api!.stageTree).toEqual(tree);
  });
});
