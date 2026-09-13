import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../Window";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import type { RuntimeCommandTracker } from "../viewer/core/runtimeCommandTracker";
import type { SectionPlaneExchange } from "./sectionPlaneBridge";
const ORIGIN = "http://127.0.0.1:8004", TRACE = "ifcready_section_test";
interface Target {
  state: Record<string, unknown>;
  componentMounted: boolean; reviewSocketEpoch: number; stageIntentGeneration: number; streamGeneration: number;
  verifiedDataChannelAuthority: unknown;
  _handleParentMessage(event: MessageEvent): void;
  _handleCustomEvent(event: { event_type: string; payload: object }, generation?: number): void;
  _hasRemoteVideoFrame(): boolean;
  sectionExchange: SectionPlaneExchange;
  runtimeCommandTracker: RuntimeCommandTracker;
  componentDidUpdate(): void;
}
let target: Target;
let parent: { postMessage: ReturnType<typeof vi.fn> };
const savedEnv = { ...reviewEnv };
const originalParent = window.parent, originalReferrer = document.referrer;
beforeEach(() => {
  vi.stubEnv("VITE_ALLOWED_COORDINATOR_ORIGINS", ORIGIN);
  window.history.replaceState({}, "", "/?session=review_session_section&trace_id=" + TRACE);
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  Object.defineProperty(document, "referrer", { value: ORIGIN + "/ui", configurable: true });
  reviewEnv.viewerLeaseToken = "test-only-lease"; reviewEnv.sourceClientId = "test-only-primary";
  const app = new App({} as never); target = app as unknown as Target;
  target.componentMounted = true;
  target.verifiedDataChannelAuthority = { sessionId: "review_session_section", traceId: TRACE, connectionGeneration: target.reviewSocketEpoch };
  target.state = { ...target.state, viewerTab: "issues", reviewSessionId: "review_session_section", reviewLifecycleStatus: "active",
    stageLoadStatus: "matched", latestStreamConfig: { session_id: "review_session_section", trace_id: TRACE } };
  vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(true);
  vi.spyOn(app, "setState").mockImplementation((update: unknown) => {
    const patch = typeof update === "function" ? update(target.state) : update;
    if (patch && typeof patch === "object") target.state = { ...target.state, ...patch };
  });
  vi.spyOn(AppStream, "sendMessage").mockResolvedValue(undefined as never);
});
afterEach(() => {
  target.sectionExchange.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  Object.assign(reviewEnv, savedEnv);
  Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
  Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
});
const input = { enabled: true, axis: "z", direction: 1, position: 2 };
function send(section: unknown = input, origin = ORIGIN, source: unknown = parent) {
  target._handleParentMessage(new MessageEvent("message", { origin, source: source as Window,
    data: { protocol: "vg01", type: "section_plane", section, clientRequestId: "local_1" } }));
}
function requestId() {
  return (vi.mocked(AppStream.sendMessage).mock.calls[0][0] as { payload: { request_id: string } }).payload.request_id;
}
function ack(overrides: object = {}) {
  target._handleCustomEvent({ event_type: "clipPlaneResult", payload: { request_id: requestId(), trace_id: TRACE,
    result: "success", enabled: true, planes: [[0, 0, 1, -2]], ...overrides } });
}
describe("real section parent -> central send -> Kit result path", () => {
  it("sends real trace/lease and confirms only matching Kit readback", () => {
    send();
    expect(AppStream.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ event_type: "clipPlaneRequest", payload: expect.objectContaining({
      trace_id: TRACE, viewer_lease_token: "test-only-lease", role: "primary", normal: [0, 0, 1],
    }) }));
    expect(parent.postMessage).not.toHaveBeenCalled();
    ack({ request_id: "unknown" }); expect(parent.postMessage).not.toHaveBeenCalled();
    ack(); expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "section_result", status: "applied", clientRequestId: "local_1" }), ORIGIN);
    expect(target.runtimeCommandTracker.getTerminal(requestId())?.outcome).toBe("success");
    ack(); expect(parent.postMessage).toHaveBeenCalledTimes(1);
  });
  it.each(["origin", "source", "referrer", "lease", "closed", "payload", "trace"] as const)("does not send through invalid %s", kind => {
    if (kind === "referrer") Object.defineProperty(document, "referrer", { value: "https://other.test/ui", configurable: true });
    if (kind === "lease") reviewEnv.viewerLeaseToken = "";
    if (kind === "closed") target.state.reviewLifecycleStatus = "closed";
    if (kind === "trace") target.verifiedDataChannelAuthority = null;
    send(kind === "payload" ? { ...input, viewer_lease_token: "injected" } : input,
      kind === "origin" ? "https://evil.test" : ORIGIN, kind === "source" ? window : parent);
    expect(AppStream.sendMessage).not.toHaveBeenCalled();
  });
  it("rejects wrong inbound trace and stale stage before lifecycle callback", () => {
    send(); ack({ trace_id: "wrong" }); expect(parent.postMessage).not.toHaveBeenCalled();
    target.stageIntentGeneration++;
    ack();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unconfirmed" }), ORIGIN);
    expect(target.runtimeCommandTracker.getTerminal(requestId())?.outcome).toBe("superseded");
  });
  it("keeps original rejection terminal and notifies the matching UI", () => {
    send();
    target._handleCustomEvent({ event_type: "commandRejected", payload: { request_id: requestId(), trace_id: TRACE,
      rejected_event_type: "clipPlaneRequest", reason: "lease_invalid", runtime_state: "unchanged", retryable: true } });
    expect(target.runtimeCommandTracker.getTerminal(requestId())?.outcome).toBe("rejected");
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error", reason: "rejected" }), ORIGIN);
  });
  it("keeps original transport terminal and exposes no private error", async () => {
    vi.mocked(AppStream.sendMessage).mockRejectedValue(new Error("private-token-diagnostic")); send();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(target.runtimeCommandTracker.getTerminal(requestId())?.outcome).toBe("error");
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "transport" }), ORIGIN);
    expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("private-token");
  });
  it("invalidates confirmed state on a lifecycle change without sending another command", () => {
    send(); ack(); target.state.stageLoadStatus = "pending"; target.componentDidUpdate();
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "unconfirmed" }), ORIGIN);
    expect(AppStream.sendMessage).toHaveBeenCalledTimes(1);
  });
});
