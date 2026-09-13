import { afterEach, expect, it, vi } from "vitest";
import App from "../Window";
import { reviewEnv } from "../config/env";

interface Target {
  state: Record<string, unknown>;
  _withRuntimeAuthority(message: { event_type: string; payload: object }): { payload: object };
  _runtimeMutatorBlockReason(eventType: string): string | null;
}
const original = { ...reviewEnv };
afterEach(() => { Object.assign(reviewEnv, original); vi.restoreAllMocks(); });

it("wraps clip commands with the real central authority method", () => {
  reviewEnv.viewerLeaseToken = "test-only-clip-lease";
  reviewEnv.sourceClientId = "viewer_lease_clip";
  const target = new App({} as never) as unknown as Target;
  const result = target._withRuntimeAuthority({ event_type: "clipPlaneRequest", payload: { enabled: true } });
  expect(result.payload).toMatchObject({
    enabled: true, role: "primary", source_client_id: "viewer_lease_clip",
    viewer_lease_token: "test-only-clip-lease", request_id: expect.any(String),
  });
});

it("blocks a clip command when closed or missing the primary lease", () => {
  const target = new App({} as never) as unknown as Target;
  target.state = { ...target.state, reviewSessionId: "review_session_clip", reviewLifecycleStatus: "closed" };
  expect(target._runtimeMutatorBlockReason("clipPlaneRequest")).toContain("closed");
  target.state = { ...target.state, reviewLifecycleStatus: "active" };
  reviewEnv.viewerLeaseToken = "";
  expect(target._runtimeMutatorBlockReason("clipPlaneRequest")).toContain("lease");
});
