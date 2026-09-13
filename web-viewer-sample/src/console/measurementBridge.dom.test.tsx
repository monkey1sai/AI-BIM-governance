import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../Window";
import AppStream from "../AppStream";
import { reviewEnv } from "../config/env";
import type { RuntimeCommandTracker } from "../viewer/core/runtimeCommandTracker";
import type { MeasurementExchange } from "./measurementBridge";
const ORIGIN = "http://127.0.0.1:8004", TRACE = "ifcready_section_test";
interface Target {
  state: Record<string, unknown>;
  componentMounted: boolean; reviewSocketEpoch: number; stageIntentGeneration: number; streamGeneration: number;
  verifiedDataChannelAuthority: unknown;
  _handleParentMessage(event: MessageEvent): void;
  _handleCustomEvent(event: { event_type: string; payload: object }, generation?: number): void;
  _hasRemoteVideoFrame(): boolean;
  measurementExchange: MeasurementExchange;
  runtimeCommandTracker: RuntimeCommandTracker;
  componentDidUpdate(): void;
  _cancelMeasurementKey(event: KeyboardEvent): void;
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
  window.removeEventListener("keydown", target._cancelMeasurementKey, true);
  window.removeEventListener("keyup", target._cancelMeasurementKey, true);
  target.measurementExchange.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers();
  Object.assign(reviewEnv, savedEnv);
  Object.defineProperty(window, "parent", { value: originalParent, configurable: true });
  Object.defineProperty(document, "referrer", { value: originalReferrer, configurable: true });
});

function send(action = "start", origin = ORIGIN, source: unknown = parent) {
  target._handleParentMessage(new MessageEvent("message", { origin, source: source as Window,
    data: { protocol: "vg01", type: "measurement_control", action } }));
}
it.each(["pending", "result"] as const)("trusted lease rotation immediately invalidates %s without rendering", async status => {
  send(); await Promise.resolve();
  const raw = vi.mocked(AppStream.sendMessage).mock.calls[0][0];
  const message = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (status === "result") target.measurementExchange.state = { status: "result", distanceMetres: 2.3 };
  target._handleParentMessage(new MessageEvent("message", { origin: ORIGIN, source: parent as unknown as Window,
    data: { protocol: "vg01", type: "viewer_lease_token", token: "replacement-test-only", user_token: "next-test-user" } }));
  expect(target.measurementExchange.state.status).toBe("unconfirmed");
  expect(target.measurementExchange.capturesInput).toBe(false);
  target._handleCustomEvent({ event_type: "measurementResult", payload: { ...message.payload, status: "started", meters_per_unit: 1 } }, target.streamGeneration);
  expect(target.measurementExchange.state.status).toBe("unconfirmed");
  expect(JSON.stringify(parent.postMessage.mock.calls)).not.toContain("replacement-test-only");
});
it("real Window bridge applies authority and blocks forged parent messages", async () => {
  send("start", "http://untrusted.invalid"); send("start", ORIGIN, {});
  expect(AppStream.sendMessage).not.toHaveBeenCalled();
  send(); await Promise.resolve();
  expect(AppStream.sendMessage).toHaveBeenCalledOnce();
  const raw = vi.mocked(AppStream.sendMessage).mock.calls[0][0];
  const message = typeof raw === "string" ? JSON.parse(raw) : raw;
  expect(message).toMatchObject({ event_type: "measurementRequest", payload: {
    action: "start", role: "primary", source_client_id: "test-only-primary", viewer_lease_token: "test-only-lease", trace_id: TRACE,
  } });
  target.componentDidUpdate();
  expect(target.measurementExchange.state.status).toBe("pending");
  target._handleCustomEvent({ event_type: "measurementResult", payload: { ...message.payload, status: "started", meters_per_unit: 1 } }, target.streamGeneration);
  expect(target.measurementExchange.state.status).toBe("first");
  expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "measurement_state", status: "first" }), ORIGIN);
});
it("current Stage/first-frame authority is necessary to start picking", () => {
  vi.spyOn(target, "_hasRemoteVideoFrame").mockReturnValue(false);
  send();
  expect(AppStream.sendMessage).not.toHaveBeenCalled();
  expect(target.measurementExchange.state.status).toBe("error");
});
it("stage replacement invalidates pending work and ignores its response", () => {
  send();
  target.stageIntentGeneration++;
  target.componentDidUpdate();
  expect(target.measurementExchange.state.status).toBe("unconfirmed");
});
it("measurement rejection immediately releases input capture", async () => {
  send(); await Promise.resolve();
  const raw = vi.mocked(AppStream.sendMessage).mock.calls[0][0];
  const message = typeof raw === "string" ? JSON.parse(raw) : raw;
  target._handleCustomEvent({ event_type: "commandRejected", payload: {
    request_id: message.payload.request_id, trace_id: TRACE, session_id: "review_session_section",
    rejected_event_type: "measurementRequest", reason: "lease_invalid", retryable: false, runtime_state: "unchanged",
  } }, target.streamGeneration);
  expect(target.measurementExchange.state).toMatchObject({ status: "error", reason: "rejected" });
  expect(target.measurementExchange.capturesInput).toBe(false);
});
it("captures camera keys before the first pointer click and Escape cancels", () => {
  send(); target.componentDidUpdate();
  const key = new KeyboardEvent("keydown", { key: "w", cancelable: true });
  window.dispatchEvent(key); expect(key.defaultPrevented).toBe(true);
  const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  window.dispatchEvent(escape); expect(escape.defaultPrevented).toBe(true);
});
