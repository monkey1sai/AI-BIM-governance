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
  ruleCode: null, severity: null, label: null, expectedStageUrl: null,
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

describe("Workspace real iframe client ownership (controlled API)", () => {
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
  it("retains the same iframe and lease across Dock removal/replacement, releasing only on Workspace unmount", async () => {
    const iframe = await start();
    const source = iframe.getAttribute("src");
    expect(source).toContain(sessionId);
    expect(source).not.toContain(lease.lease_token);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    await render(null);
    expect(container.querySelector("iframe")).toBe(iframe);
    await render("a3-inline");
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(iframe.getAttribute("src")).toBe(source);
    expect(api!.activeSessionId).toBe(sessionId);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenLastCalledWith(sessionId, lease.lease_id, lease.lease_token, expect.any(Object));
    await act(async () => { root!.unmount(); });
    root = null;
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledWith(sessionId, lease.lease_id, lease.lease_token);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledTimes(1);
  });
  it("explicit clear removes the iframe and releases once; old Dock metadata cannot reclaim", async () => {
    const iframe = await start();
    await act(async () => { api!.setActiveSessionId(""); });
    await flush();
    expect(container.querySelector("iframe")).toBeNull();
    expect(iframe.isConnected).toBe(false);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    await render(null);
    await render("a3-inline");
    expect(api!.activeSessionId).toBe("");
    expect(container.querySelector("iframe")).toBeNull();
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise; reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }
  async function beginPendingClaim() {
    await render("a1-inline");
    const button = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-manual-start"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => { button.click(); });
    await flush();
  }
  async function clearAndReselect() {
    await act(async () => { api!.setActiveSessionId(""); });
    await flush();
    await act(async () => { api!.setActiveSessionId(sessionId); });
    await flush();
  }
  it("releases a claim that succeeds after Workspace unmount", async () => {
    const pending = deferred<ViewerLeaseClaimResponse>();
    vi.mocked(coordinatorClient.claimViewerLease).mockReturnValueOnce(pending.promise);
    await beginPendingClaim();
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    await act(async () => { root!.unmount(); });
    root = null;
    await act(async () => { pending.resolve(lease); });
    await flush();
    expect(container.querySelector("iframe")).toBeNull();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledWith(sessionId, lease.lease_id, lease.lease_token);
  });
  it("releases an abandoned claim without replacing a newer claim for the same session", async () => {
    const pending = deferred<ViewerLeaseClaimResponse>();
    const newer = { ...lease, lease_id: "test_newer_claim", lease_token: "synthetic_newer_token" };
    vi.mocked(coordinatorClient.claimViewerLease).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(newer);
    await beginPendingClaim();
    await clearAndReselect();
    const currentIframe = await start();
    await act(async () => { pending.resolve(lease); });
    await flush();
    expect(container.querySelector("iframe")).toBe(currentIframe);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledWith(sessionId, lease.lease_id, lease.lease_token);
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalledWith(sessionId, newer.lease_id, newer.lease_token);
  });
  it("ignores an old heartbeat failure after clear and a newer claim", async () => {
    const pending = deferred<ViewerLeaseClaimResponse>();
    const newer = { ...lease, lease_id: "test_newer_heartbeat", lease_token: "synthetic_newer_token" };
    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockReturnValueOnce(pending.promise);
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledTimes(1);
    await clearAndReselect();
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValueOnce(newer);
    const currentIframe = await start();
    await act(async () => { pending.reject(new Error("404 Viewer lease not found or token invalid")); });
    await flush();
    expect(container.querySelector("iframe")).toBe(currentIframe);
    expect(container.querySelector('[data-testid="a1-inline-lease-expired"]')).toBeNull();
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalledWith(sessionId, newer.lease_id, newer.lease_token);
  });
  it("ignores a late manual release result after clear and a newer claim", async () => {
    const pending = deferred<ViewerLeaseClaimResponse>();
    const newer = { ...lease, lease_id: "test_newer_release", lease_token: "synthetic_newer_token" };
    await start();
    vi.mocked(coordinatorClient.releaseViewerLease).mockReturnValueOnce(pending.promise);
    const leave = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-leave-3d"]')!;
    await act(async () => { leave.click(); });
    await flush();
    await clearAndReselect();
    expect(vi.mocked(coordinatorClient.releaseViewerLease).mock.calls.filter(
      (args) => args[1] === lease.lease_id && args[2] === lease.lease_token,
    )).toHaveLength(1);
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValueOnce(newer);
    const currentIframe = await start();
    await act(async () => { pending.resolve(lease); });
    await flush();
    expect(container.querySelector("iframe")).toBe(currentIframe);
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalledWith(sessionId, newer.lease_id, newer.lease_token);
  });
  it("shares a pending pre-claim release with cleanup after session clear", async () => {
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    const pending = deferred<ViewerLeaseClaimResponse>();
    vi.mocked(coordinatorClient.releaseViewerLease).mockReturnValueOnce(pending.promise);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-first-frame-retry"]')!;
    await act(async () => { retry.click(); });
    await flush();
    await clearAndReselect();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledWith(sessionId, lease.lease_id, lease.lease_token);
    await act(async () => { pending.resolve(lease); });
    await flush();
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
    expect(container.querySelector("iframe")).toBeNull();
  });
  it("ignores the old heartbeat when the same session accepts a new lease before React renders", async () => {
    const oldHeartbeat = deferred<ViewerLeaseClaimResponse>();
    const newClaim = deferred<ViewerLeaseClaimResponse>();
    const newer = { ...lease, lease_id: "test_same_epoch", lease_token: "synthetic_same_epoch" };
    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockReturnValueOnce(oldHeartbeat.promise);
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    vi.mocked(coordinatorClient.claimViewerLease).mockReturnValueOnce(newClaim.promise);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-first-frame-retry"]')!;
    await act(async () => {
      retry.click();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
      newClaim.resolve(newer);
      await Promise.resolve();
      oldHeartbeat.reject(new Error("404 Viewer lease not found or token invalid"));
      await Promise.resolve();
    });
    await flush();
    expect(api!.activeSessionId).toBe(sessionId);
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector('[data-testid="a1-inline-lease-expired"]')).toBeNull();
    expect(coordinatorClient.releaseViewerLease).not.toHaveBeenCalledWith(sessionId, newer.lease_id, newer.lease_token);
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenLastCalledWith(sessionId, newer.lease_id, newer.lease_token, expect.any(Object));
  });
  it("clears an old lease expiry when a retry obtains a new lease", async () => {
    const oldHeartbeat = deferred<ViewerLeaseClaimResponse>();
    const oldRelease = deferred<ViewerLeaseClaimResponse>();
    const newer = { ...lease, lease_id: "test_retry_after_expiry", lease_token: "synthetic_retry_after_expiry" };
    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockReturnValueOnce(oldHeartbeat.promise);
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); });
    vi.mocked(coordinatorClient.releaseViewerLease).mockReturnValueOnce(oldRelease.promise);
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValueOnce(newer);
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-first-frame-retry"]')!;
    await act(async () => { retry.click(); });
    await flush();
    await act(async () => { oldHeartbeat.reject(new Error("404 Viewer lease not found or token invalid")); });
    await flush();
    expect(container.querySelector('[data-testid="a1-inline-lease-expired"]')).not.toBeNull();
    await act(async () => { oldRelease.resolve(lease); });
    await flush();
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector('[data-testid="a1-inline-lease-expired"]')).toBeNull();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
  });
  it("allows later unmount cleanup to retry a failed manual release", async () => {
    await start();
    vi.mocked(coordinatorClient.releaseViewerLease).mockRejectedValueOnce(new Error("release unavailable"));
    const leave = container.querySelector<HTMLButtonElement>('[data-testid="a1-inline-leave-3d"]')!;
    await act(async () => { leave.click(); });
    await flush();
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(1);
    await act(async () => { root!.unmount(); });
    root = null;
    await flush();
    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledTimes(2);
    expect(coordinatorClient.releaseViewerLease).toHaveBeenLastCalledWith(sessionId, lease.lease_id, lease.lease_token);
  });
});
