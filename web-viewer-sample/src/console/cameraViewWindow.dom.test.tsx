import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../Window";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import { resetTestCredentials, testCredentials, withTestCredentials } from "./__testdata__/viewerCredentials";
import type { BorrowedViewerCredentials } from "../clients/viewerCredentials";
import type { RuntimeCommandTracker } from "../viewer/core/runtimeCommandTracker";

const ORIGIN = "http://127.0.0.1:8004", TRACE = "ifcready_camera_test", SESSION = "review_session_camera";
interface Disposable { dispose(): void }
interface Target {
  state: Record<string, unknown>;
  componentMounted: boolean; reviewSocketEpoch: number; stageIntentGeneration: number;
  verifiedDataChannelAuthority: unknown;
  _handleParentMessage(event: MessageEvent): void;
  _handleCustomEvent(event: { event_type: string; payload: object }, generation?: number): void;
  _hasRemoteVideoFrame(): boolean;
  cameraViewExchange: Disposable; cameraStateExchange: Disposable; flyNavigationExchange: Disposable;
  measurementExchange: { capturesInput: boolean };
  runtimeCommandTracker: RuntimeCommandTracker;
  componentDidUpdate(): void;
}
let target: Target;
let credentials: BorrowedViewerCredentials;
let parent: { postMessage: ReturnType<typeof vi.fn> };
const savedEnv = { ...reviewEnv };
const originalParent = window.parent, originalReferrer = document.referrer;
const camera = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  target_distance: 30, fov_deg: 40, ortho_height: null };

beforeEach(() => {
  vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", ORIGIN);
  window.history.replaceState({}, "", `/?session=${SESSION}&trace_id=${TRACE}`);
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  Object.defineProperty(document, "referrer", { value: ORIGIN + "/ui", configurable: true });
  testCredentials.leaseToken = "test-only-lease"; reviewEnv.sourceClientId = "test-only-primary";
  const props = withTestCredentials({}); credentials = props.viewerCredentials!;
  const app = new App(props as never); target = app as unknown as Target;
  target.componentMounted = true;
  target.verifiedDataChannelAuthority = { sessionId: SESSION, traceId: TRACE, connectionGeneration: target.reviewSocketEpoch };
  target.state = { ...target.state, viewerTab: "issues", reviewSessionId: SESSION, reviewLifecycleStatus: "active",
    stageLoadStatus: "matched", latestStreamConfig: { session_id: SESSION, trace_id: TRACE } };
  vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(true);
  vi.spyOn(app, "setState").mockImplementation((update: unknown) => {
    const patch = typeof update === "function" ? update(target.state) : update;
    if (patch && typeof patch === "object") target.state = { ...target.state, ...patch };
  });
  vi.spyOn(AppStream, "sendMessage").mockResolvedValue(undefined as never);
});
afterEach(() => {
  target.cameraViewExchange.dispose(); target.cameraStateExchange.dispose(); target.flyNavigationExchange.dispose();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  Object.assign(reviewEnv, savedEnv);
  resetTestCredentials();
  Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
  Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
});

function fromParent(data: Record<string, unknown>, origin = ORIGIN) {
  target._handleParentMessage(new MessageEvent("message", { origin, source: parent as unknown as Window,
    data: { protocol: "vg01", ...data } }));
}
function sendCamera(cameraInput: unknown = { action: "preset", view: "top", scope: "building" }, origin = ORIGIN) {
  fromParent({ type: "camera_view", camera: cameraInput, clientRequestId: "cam_1" }, origin);
}
function sent(index = 0) {
  return vi.mocked(AppStream.sendMessage).mock.calls[index][0] as unknown as { event_type: string; payload: Record<string, unknown> };
}
function kit(eventType: string, payload: Record<string, unknown>) {
  target._handleCustomEvent({ event_type: eventType, payload: { trace_id: TRACE, ...payload } });
}

describe("camera commands from the unified workspace to Kit", () => {
  it("sends a traced primary preset and confirms only the matching Kit readback", () => {
    sendCamera();
    expect(sent()).toMatchObject({ event_type: "cameraViewRequest", payload: {
      trace_id: TRACE, viewer_lease_token: "test-only-lease", role: "primary", action: "preset", view: "top", scope: "building" } });
    kit("cameraViewResult", { request_id: "unknown", result: "success", camera });
    expect(parent.postMessage).not.toHaveBeenCalled();
    const requestId = sent().payload.request_id as string;
    kit("cameraViewResult", { request_id: requestId, result: "success", camera });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "applied", clientRequestId: "cam_1", camera: expect.objectContaining({ targetDistance: 30 }) }), ORIGIN);
    expect(target.runtimeCommandTracker.getTerminal(requestId)?.outcome).toBe("success");
  });
  it("reports a readback mismatch when Kit looks the wrong way", () => {
    sendCamera();
    kit("cameraViewResult", { request_id: sent().payload.request_id, result: "success", camera: { ...camera, direction: [0, 1, 0] } });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "readback" }), ORIGIN);
  });
  it.each(["origin", "lease", "closed"] as const)("does not send through invalid %s", kind => {
    if (kind === "lease") credentials.accept({ leaseToken: "" });
    if (kind === "closed") target.state.reviewLifecycleStatus = "closed";
    sendCamera(undefined, kind === "origin" ? "https://evil.test" : ORIGIN);
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
  });
  it("refuses injected fields without sending", () => {
    sendCamera({ action: "preset", view: "top", scope: "building", viewer_lease_token: "injected" });
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "invalid" }), ORIGIN);
  });
  it("maps a Kit rejection to the camera UI", () => {
    sendCamera();
    kit("commandRejected", { request_id: sent().payload.request_id, rejected_event_type: "cameraViewRequest",
      reason: "spectator_readonly", runtime_state: "unchanged", retryable: false });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "rejected" }), ORIGIN);
  });
  it("maps a transport failure without exposing private text", async () => {
    vi.mocked(AppStream.sendMessage).mockRejectedValue(new Error("private-token-diagnostic"));
    sendCamera();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "transport" }), ORIGIN);
    expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("private-token");
  });
  it("reads camera state without mutator authority fields", () => {
    fromParent({ type: "camera_state", clientRequestId: "state_1" });
    expect(sent().event_type).toBe("cameraStateRequest");
    expect(sent().payload).toMatchObject({ trace_id: TRACE, session_id: SESSION });
    expect(sent().payload).not.toHaveProperty("viewer_lease_token");
    kit("cameraStateResult", { request_id: sent().payload.request_id, result: "success", camera });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_state_result",
      status: "applied", clientRequestId: "state_1" }), ORIGIN);
  });
  it("reports a refused read-only camera-state request immediately instead of waiting for the parent timeout, without raising the mutator rejection banner", () => {
    fromParent({ type: "camera_state", clientRequestId: "state_1" });
    kit("commandRejected", { request_id: sent().payload.request_id, rejected_event_type: "cameraStateRequest",
      reason: "lease_invalid", runtime_state: "unchanged", retryable: true, detail_code: "authority_unavailable" });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_state_result",
      status: "error", reason: "rejected" }), ORIGIN);
    expect(target.state.runtimeCommandRejection).toBeNull();
  });
  it("logs but does not raise the mutator rejection banner for repeated read-only loadingStateQuery refusals without a request_id", () => {
    kit("commandRejected", { rejection_id: "rej_loading_state_001", rejected_event_type: "loadingStateQuery",
      reason: "lease_invalid", runtime_state: "unchanged", retryable: true, detail_code: "authority_unavailable" });
    expect(target.state.runtimeCommandRejection).toBeNull();
    kit("commandRejected", { rejection_id: "rej_loading_state_002", rejected_event_type: "loadingStateQuery",
      reason: "lease_invalid", runtime_state: "unchanged", retryable: true, detail_code: "authority_unavailable" });
    expect(target.state.runtimeCommandRejection).toBeNull();
    const reviewEvents = target.state.reviewEvents as string[];
    expect(reviewEvents.filter(event => /loadingStateQuery/.test(event))).toHaveLength(2);
    expect(reviewEvents.some(event => /malformed|格式錯誤/.test(event))).toBe(false);
  });
  it("applies fly speed from Kit readback", () => {
    fromParent({ type: "fly_navigation", speed: 3, clientRequestId: "fly_1" });
    expect(sent()).toMatchObject({ event_type: "flyNavigationRequest", payload: { speed: 3, role: "primary" } });
    kit("flyNavigationResult", { request_id: sent().payload.request_id, result: "success", speed: 2 });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "fly_navigation_result",
      status: "applied", speed: 2, clientRequestId: "fly_1" }), ORIGIN);
  });
  it("invalidates a confirmed camera when the stage changes", () => {
    sendCamera();
    kit("cameraViewResult", { request_id: sent().payload.request_id, result: "success", camera });
    target.state.stageLoadStatus = "pending"; target.componentDidUpdate();
    expect(parent.postMessage).toHaveBeenLastCalledWith({ protocol: "vg01", type: "camera_view_result",
      status: "unconfirmed" }, ORIGIN);
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("posts unavailable for camera_state instead of waiting out the parent timeout when the viewer cannot operate", () => {
    target.state.reviewLifecycleStatus = "closed";
    fromParent({ type: "camera_state", clientRequestId: "state_1" });
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_state_result",
      status: "error", reason: "unavailable", clientRequestId: "state_1" }), ORIGIN);
  });
  it("blocks camera_view and fly_navigation while measurement picking captures input", () => {
    Object.defineProperty(target.measurementExchange, "capturesInput", { get: () => true, configurable: true });
    sendCamera();
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "error", reason: "unavailable", clientRequestId: "cam_1" }), ORIGIN);
    fromParent({ type: "fly_navigation", speed: 3, clientRequestId: "fly_1" });
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "fly_navigation_result",
      status: "error", reason: "unavailable", clientRequestId: "fly_1" }), ORIGIN);
  });
});
