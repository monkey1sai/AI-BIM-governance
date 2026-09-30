import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../Window";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import { resetTestCredentials, testCredentials, withTestCredentials } from "../console/__testdata__/viewerCredentials";

const ORIGIN = "http://127.0.0.1:8004", TRACE = "ifcready_compass_test", SESSION = "review_session_compass";
interface Target {
  state: Record<string, unknown>;
  componentMounted: boolean; reviewSocketEpoch: number;
  verifiedDataChannelAuthority: unknown;
  _handleParentMessage(event: MessageEvent): void;
  _handleCustomEvent(event: { event_type: string; payload: object }, generation?: number): void;
  _hasRemoteVideoFrame(): boolean;
  _renderCompassHud(): ReactNode;
  _onStreamPointerDownCapture(event: { target: EventTarget | null }): void;
  _onCompassPointerEnd(): void;
  commandChannel: { dispose(): void };
  compassFeed: { start(): void; dispose(): void };
  componentDidUpdate(): void;
}
let target: Target;
let parent: { postMessage: ReturnType<typeof vi.fn> };
const savedEnv = { ...reviewEnv };
const originalParent = window.parent, originalReferrer = document.referrer;
const lookingEast = { projection: "perspective", position: [-30, 0, 10], direction: [1, 0, 0], up: [0, 0, 1],
  target_distance: 30, fov_deg: 40, ortho_height: null };
const topView = { projection: "perspective", position: [0, 0, 30], direction: [0, 0, -1], up: [0, 1, 0],
  target_distance: 30, fov_deg: 40, ortho_height: null };

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", ORIGIN);
  window.history.replaceState({}, "", `/?session=${SESSION}&trace_id=${TRACE}`);
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  Object.defineProperty(document, "referrer", { value: ORIGIN + "/ui", configurable: true });
  testCredentials.leaseToken = "test-only-lease"; reviewEnv.sourceClientId = "test-only-primary";
  const app = new App(withTestCredentials({}) as never); target = app as unknown as Target;
  target.componentMounted = true;
  target.verifiedDataChannelAuthority = { sessionId: SESSION, traceId: TRACE, connectionGeneration: target.reviewSocketEpoch };
  target.state = { ...target.state, viewerTab: "model", showStream: true, reviewSessionId: SESSION, reviewLifecycleStatus: "active",
    stageLoadStatus: "pending", latestStreamConfig: { session_id: SESSION, trace_id: TRACE } };
  vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(true);
  vi.spyOn(app, "setState").mockImplementation((update: unknown) => {
    const patch = typeof update === "function" ? update(target.state) : update;
    if (patch && typeof patch === "object") target.state = { ...target.state, ...patch };
  });
  vi.spyOn(AppStream, "sendMessage").mockResolvedValue(undefined as never);
  // componentDidMount starts the feed in the product; these tests construct the viewer without mounting it.
  target.compassFeed.start();
});
afterEach(() => {
  target.compassFeed.dispose();
  target.commandChannel.dispose();
  document.getElementById("main-div")?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  Object.assign(reviewEnv, savedEnv);
  resetTestCredentials();
  Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
  Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
});

function sent(index: number) {
  return vi.mocked(AppStream.sendMessage).mock.calls[index][0] as unknown as { event_type: string; payload: Record<string, unknown> };
}
function kit(eventType: string, payload: Record<string, unknown>) {
  target._handleCustomEvent({ event_type: eventType, payload: { trace_id: TRACE, ...payload } });
}
function stageOpened() {
  target.componentDidUpdate();
  target.state.stageLoadStatus = "matched";
  target.componentDidUpdate();
}
function renderedCompass(): HTMLElement | null {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<>{target._renderCompassHud()}</>));
  const hud = container.querySelector<HTMLElement>('[data-testid="viewer-compass"]');
  const snapshot = hud ? (hud.cloneNode(true) as HTMLElement) : null;
  act(() => root.unmount());
  return snapshot;
}

describe("project-north compass HUD in the viewer", () => {
  it("reads the camera once the stage is shown and turns the rose from its own reply without replying to the parent", () => {
    target.componentDidUpdate();
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
    stageOpened();
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
    const request = sent(0);
    expect(request.event_type).toBe("cameraStateRequest");
    expect(request.payload.request_id).toMatch(/^hud_cam_/);
    expect(request.payload).toMatchObject({ trace_id: TRACE, session_id: SESSION });
    expect(request.payload).not.toHaveProperty("viewer_lease_token");
    target.componentDidUpdate();
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
    expect(renderedCompass()!.dataset.heading).toBe("");

    kit("cameraStateResult", { request_id: request.payload.request_id, result: "success", camera: lookingEast });

    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(target.state.compassHeading).toBe(90);
    expect(renderedCompass()!.dataset.heading).toBe("90");
  });

  it("stays out of a parent camera command's way and reads the camera from its reply", () => {
    target.state.stageLoadStatus = "matched";
    target._handleParentMessage(new MessageEvent("message", { origin: ORIGIN, source: parent as unknown as Window,
      data: { protocol: "vg01", type: "camera_view", camera: { action: "preset", view: "top", scope: "building" }, clientRequestId: "cam_1" } }));
    expect(sent(0).event_type).toBe("cameraViewRequest");
    target.componentDidUpdate();
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);

    kit("cameraViewResult", { request_id: sent(0).payload.request_id, result: "success", camera: topView });

    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "camera_view_result",
      status: "applied", clientRequestId: "cam_1" }), ORIGIN);
    expect(target.state.compassHeading).toBe(0);
  });

  it("keeps a refused compass read out of the review log and the rejection banner", () => {
    stageOpened();
    const before = (target.state.reviewEvents as string[]).length;
    kit("commandRejected", { request_id: sent(0).payload.request_id, rejected_event_type: "cameraStateRequest",
      reason: "lease_invalid", runtime_state: "unchanged", retryable: true, detail_code: "authority_unavailable" });
    expect((target.state.reviewEvents as string[]).length).toBe(before);
    expect(target.state.runtimeCommandRejection).toBeNull();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it("follows a drag that starts on the stream and reads once more after release", () => {
    vi.useFakeTimers();
    target.state.stageLoadStatus = "matched";
    const surface = document.createElement("div");
    surface.id = "main-div";
    const video = document.createElement("video");
    surface.appendChild(video);
    document.body.appendChild(surface);

    target._onStreamPointerDownCapture({ target: document.body });
    vi.advanceTimersByTime(1_000);
    expect(AppStream.sendMessage).not.toHaveBeenCalled();

    target._onStreamPointerDownCapture({ target: video });
    vi.advanceTimersByTime(250);
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
    kit("cameraStateResult", { request_id: sent(0).payload.request_id, result: "success", camera: lookingEast });
    target._onCompassPointerEnd();
    vi.advanceTimersByTime(1_000);
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(2);
    expect(sent(1).payload.request_id).toMatch(/^hud_cam_/);
  });

  it("is hidden while the loading or failure overlay covers the stage and on the issues tab", () => {
    target.state.stageLoadStatus = "matched";
    expect(renderedCompass()).not.toBeNull();
    target.state.showStream = false;
    expect(renderedCompass()).toBeNull();
    target.state.showStream = true; target.state.viewerTab = "issues";
    expect(renderedCompass()).toBeNull();
  });
});
