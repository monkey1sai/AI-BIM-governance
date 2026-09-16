import { afterEach, expect, it, vi } from "vitest";
import App from "../Window";
import { reviewEnv } from "../config/env";
import { resetTestCredentials, testCredentials, withTestCredentials } from "./__testdata__/viewerCredentials";

interface Target {
  state: Record<string, unknown>;
  _withRuntimeAuthority(message: { event_type: string; payload: object }): { payload: object };
  _runtimeMutatorBlockReason(eventType: string): string | null;
}
const original = { ...reviewEnv };
afterEach(() => { Object.assign(reviewEnv, original); resetTestCredentials(); vi.restoreAllMocks(); });

it("wraps clip commands with the real central authority method", () => {
  testCredentials.leaseToken = "test-only-clip-lease";
  reviewEnv.sourceClientId = "viewer_lease_clip";
  const target = new App(withTestCredentials({}) as never) as unknown as Target;
  const result = target._withRuntimeAuthority({ event_type: "clipPlaneRequest", payload: { enabled: true } });
  expect(result.payload).toMatchObject({
    enabled: true, role: "primary", source_client_id: "viewer_lease_clip",
    viewer_lease_token: "test-only-clip-lease", request_id: expect.any(String),
  });
});

it("blocks a clip command when closed or missing the primary lease", () => {
  testCredentials.leaseToken = "test-only-clip-lease";
  const props = withTestCredentials({});
  const target = new App(props as never) as unknown as Target;
  target.state = { ...target.state, reviewSessionId: "review_session_clip", reviewLifecycleStatus: "closed" };
  expect(target._runtimeMutatorBlockReason("clipPlaneRequest")).toContain("closed");
  target.state = { ...target.state, reviewLifecycleStatus: "active" };
  expect(target._runtimeMutatorBlockReason("clipPlaneRequest")).toBeNull();
  props.viewerCredentials!.accept({ leaseToken: "" });
  expect(target._runtimeMutatorBlockReason("clipPlaneRequest")).toContain("lease");
});
