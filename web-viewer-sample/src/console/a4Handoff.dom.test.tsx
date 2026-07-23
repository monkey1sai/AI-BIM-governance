import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppStream from "../AppStream";
import App from "../Window";
import { A4_HANDOFF_COMMAND_TIMEOUT_MS, type A4HandoffIntent } from "../clients/a4Handoff";
import { CoordinatorHttpError } from "../clients/coordinatorClient";
import { reviewEnv } from "../config/env";

const HANDOFF_ID = "a4h_1234567890abcdef";
const SESSION_ID = "review_session_a4_001";
const STAGE_URL = "stage://model.usdc";
const NOW_MS = Date.parse("2026-07-23T03:00:00.000Z");

type TestCoordinator = {
  consumeA4Handoff: ReturnType<typeof vi.fn>;
  getReviewSession: ReturnType<typeof vi.fn>;
  getStreamConfig: ReturnType<typeof vi.fn>;
  getA4ViewerLeaseStatus: ReturnType<typeof vi.fn>;
};

type TestHandoffViewState = {
  status: "idle" | "pending" | "succeeded" | "rejected" | "timed-out";
  phase: string;
  handoff_id: string | null;
  action: "focus" | "highlight" | null;
  request_id: string | null;
  retry_of_request_id: string | null;
  detail: string | null;
  retryable: boolean;
};

type TestAppState = Record<string, unknown> & {
  a4Handoff: TestHandoffViewState;
};

type SentMessage = {
  event_type: string;
  payload: Record<string, unknown> & { request_id: string };
};

type AppInternals = {
  state: TestAppState;
  componentMounted: boolean;
  confirmedStageBindingRevision: string | null;
  coordinatorClient: TestCoordinator;
  _ensurePrimaryViewerLease: () => Promise<string | null>;
  _beginA4Handoff: (sessionId: string) => Promise<void>;
  _retryA4Handoff: () => void;
  _handleCustomEvent: (event: { event_type: string; payload: Record<string, unknown> }) => void;
  render: () => React.ReactElement;
};

const internals = (app: App): AppInternals => app as unknown as AppInternals;

function intent(action: "focus" | "highlight" = "focus"): A4HandoffIntent {
  return {
    handoff_id: HANDOFF_ID,
    action,
    expires_at: "2026-07-23T03:01:00.000Z",
    prim_paths: action === "focus" ? ["/World/Door_001"] : ["/World/Door_001", "/World/Wall_002"],
    binding: {
      review_session_id: SESSION_ID,
      model_version_id: "model_v1",
      primary_artifact_id: "artifact_usdc_1",
      active_binding_revision: "binding_rev_1",
    },
  };
}

function streamConfig() {
  return {
    session_id: SESSION_ID,
    lifecycle_status: "active",
    source: "local_fixed",
    webrtc: { signalingServer: "127.0.0.1", signalingPort: 49100, mediaServer: "127.0.0.1" },
    model: { status: "ready", artifact_id: "artifact_usdc_1", url: STAGE_URL, mapping_url: null },
    artifacts: [],
    artifact_bindings: [],
    kit_instance_bindings: [],
    stage_composition: {
      applied_policy: "coordinator_load_order",
      primary_artifact_id: "artifact_usdc_1",
      secondary_artifact_ids: [],
      primary: {
        binding_id: "binding_1",
        artifact_group_id: "group_1",
        model_version_id: "model_v1",
        artifact_id: "artifact_usdc_1",
        artifact_role: "derived",
        url: STAGE_URL,
        mapping_url: null,
        load_order: 0,
        routing_policy: "same_instance",
        ready_status: "ready",
      },
      secondary_layers: [],
    },
  };
}

function leaseStatus(authScope: "bound" | "local_dev_lab" = "bound") {
  return {
    session_id: SESSION_ID,
    auth_scope: authScope,
    primary: { available: false, owned_by_caller: true },
    leases: [{
      lease_id: "viewer_lease_a4",
      role: "primary",
      status: "active",
      expires_at: "2026-07-23T03:01:00.000Z",
    }],
    stage_binding: { active_binding_revision: "binding_rev_1" },
  };
}

function coordinatorFor(action: "focus" | "highlight" = "focus", authScope: "bound" | "local_dev_lab" = "bound"): TestCoordinator {
  return {
    consumeA4Handoff: vi.fn().mockResolvedValue(intent(action)),
    getReviewSession: vi.fn().mockResolvedValue({
      session_id: SESSION_ID,
      status: "active",
      project_id: "project_1",
      model_version_id: "model_v1",
      created_by: "principal_1",
      kit_instance: { stream_server: "127.0.0.1", signaling_port: 49100, media_server: "127.0.0.1" },
      artifact_bindings: [],
      kit_instance_bindings: [],
    }),
    getStreamConfig: vi.fn().mockResolvedValue(streamConfig()),
    getA4ViewerLeaseStatus: vi.fn().mockResolvedValue(leaseStatus(authScope)),
  };
}

function mockSynchronousSetState(app: App): void {
  vi.spyOn(app, "setState").mockImplementation((update: unknown, callback?: () => void) => {
    const patch = typeof update === "function"
      ? (update as (state: TestAppState) => Record<string, unknown>)(internals(app).state)
      : update;
    if (patch && typeof patch === "object") {
      internals(app).state = { ...internals(app).state, ...(patch as Record<string, unknown>) } as TestAppState;
    }
    callback?.();
  });
}

function readyApp(action: "focus" | "highlight" = "focus", authScope: "bound" | "local_dev_lab" = "bound") {
  reviewEnv.a4HandoffId = HANDOFF_ID;
  reviewEnv.hasInvalidA4HandoffId = false;
  reviewEnv.userToken = "principal_carrier_a4";
  reviewEnv.viewerLeaseToken = "lease_token_a4";
  reviewEnv.sourceClientId = "viewer_lease_a4";
  const app = new App({} as never);
  mockSynchronousSetState(app);
  const target = internals(app);
  target.componentMounted = true;
  target.confirmedStageBindingRevision = "binding_rev_1";
  target.coordinatorClient = coordinatorFor(action, authScope);
  target._ensurePrimaryViewerLease = vi.fn().mockResolvedValue("lease_token_a4");
  target.state = {
    ...target.state,
    reviewSessionId: SESSION_ID,
    currentModelVersionId: "model_v1",
    reviewLifecycleStatus: "active",
    latestStreamConfig: streamConfig(),
    expectedStageUrl: STAGE_URL,
    loadedStageUrl: STAGE_URL,
    stageLoadStatus: "matched",
    isKitReady: true,
    webrtcLifecycleStatus: "started",
    showUI: true,
  };
  return { app, target, coordinator: target.coordinatorClient };
}

async function beginAndSend(target: AppInternals): Promise<SentMessage> {
  await target._beginA4Handoff(SESSION_ID);
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
  const calls = vi.mocked(AppStream.sendMessage).mock.calls;
  const call = calls[calls.length - 1];
  if (!call) throw new Error("expected A4 DataChannel send");
  return call[0] as SentMessage;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  reviewEnv.a4HandoffId = null;
  reviewEnv.hasInvalidA4HandoffId = false;
  reviewEnv.userToken = "";
  reviewEnv.viewerLeaseToken = "";
  reviewEnv.sourceClientId = "dev_user_001";
});

describe("A4 S3 trusted handoff viewer", () => {
  it("waits for DataChannel proof before consuming the single send opportunity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target } = readyApp("focus");
    target.state = { ...target.state, isKitReady: false };

    await target._beginA4Handoff(SESSION_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(target.state.a4Handoff).toMatchObject({
      status: "pending",
      phase: "waiting-readiness",
      detail: "datachannel_pending",
    });

    target.state = { ...target.state, isKitReady: true };
    await vi.advanceTimersByTimeAsync(250);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("consumes an authorized focus intent, revalidates current authority, sends once, and requires matching ack", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target, coordinator } = readyApp("focus");

    const sent = await beginAndSend(target);

    expect(coordinator.consumeA4Handoff).toHaveBeenCalledWith(
      SESSION_ID,
      HANDOFF_ID,
      "principal_carrier_a4",
      "lease_token_a4",
    );
    expect(coordinator.getReviewSession).toHaveBeenCalledTimes(1);
    expect(coordinator.getStreamConfig).toHaveBeenCalledTimes(1);
    expect(coordinator.getA4ViewerLeaseStatus).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sent.event_type).toBe("focusPrimRequest");
    expect(sent.payload).toMatchObject({
      prim_path: "/World/Door_001",
      role: "primary",
      session_id: SESSION_ID,
      source_client_id: "viewer_lease_a4",
      viewer_lease_token: "lease_token_a4",
    });
    expect(sent.payload.request_id).toMatch(/^cmd_/);
    expect(target.state.a4Handoff.status).toBe("pending");

    target._handleCustomEvent({
      event_type: "focusPrimResult",
      payload: { result: "success", request_id: sent.payload.request_id, prim_path: "/World/Door_001" },
    });
    expect(target.state.a4Handoff).toMatchObject({ status: "succeeded", detail: "matching_focus_result" });
  });

  it("shows timed-out, then explicit retry revalidates and sends one linked new highlight request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target, coordinator } = readyApp("highlight");
    const first = await beginAndSend(target);

    await vi.advanceTimersByTimeAsync(A4_HANDOFF_COMMAND_TIMEOUT_MS);
    expect(target.state.a4Handoff).toMatchObject({
      status: "timed-out",
      request_id: first.payload.request_id,
      retryable: true,
    });
    expect(renderToString(target.render())).toContain('data-testid="a4-handoff-retry"');

    target._retryA4Handoff();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(coordinator.getA4ViewerLeaseStatus).toHaveBeenCalledTimes(2);
    const retry = sendSpy.mock.calls[1][0] as SentMessage;
    expect(retry.event_type).toBe("highlightPrimsRequest");
    expect(retry.payload.request_id).not.toBe(first.payload.request_id);
    expect(retry.payload.retry_of_request_id).toBe(first.payload.request_id);
    expect(retry.payload.items).toEqual([{ prim_path: "/World/Door_001" }, { prim_path: "/World/Wall_002" }]);

    target._handleCustomEvent({
      event_type: "highlightPrimsResult",
      payload: {
        result: "success",
        request_id: retry.payload.request_id,
        selected_paths: ["/World/Door_001", "/World/Wall_002"],
        missing_paths: [],
        fallback_paths: [],
      },
    });
    expect(target.state.a4Handoff).toMatchObject({
      status: "succeeded",
      request_id: retry.payload.request_id,
      retry_of_request_id: first.payload.request_id,
    });
  });

  it("zero-sends when the shared authentic lease authority is unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target } = readyApp("focus", "local_dev_lab");

    await target._beginA4Handoff(SESSION_ID);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(sendSpy).not.toHaveBeenCalled();
    expect(target.state.a4Handoff).toMatchObject({
      status: "rejected",
      detail: "a4_authentic_lease_unavailable",
      retryable: false,
    });
  });

  it("consumes the shared correlated commandRejected terminal without inventing a producer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target } = readyApp("focus");
    const sent = await beginAndSend(target);

    target._handleCustomEvent({
      event_type: "commandRejected",
      payload: {
        rejected_event_type: "focusPrimRequest",
        reason: "lease_invalid",
        request_id: sent.payload.request_id,
        retryable: false,
        runtime_state: "unchanged",
        detail_code: "lease_expired",
      },
    });

    expect(target.state.a4Handoff).toMatchObject({
      status: "rejected",
      request_id: sent.payload.request_id,
      detail: "lease_expired",
      retryable: false,
    });
  });

  it("zero-sends retry after principal/lease drift and requires a new handoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target, coordinator } = readyApp("focus");
    await beginAndSend(target);
    await vi.advanceTimersByTimeAsync(A4_HANDOFF_COMMAND_TIMEOUT_MS);

    reviewEnv.userToken = "different_principal_carrier";
    target._retryA4Handoff();
    await Promise.resolve();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(coordinator.getA4ViewerLeaseStatus).toHaveBeenCalledTimes(1);
    expect(target.state.a4Handoff).toMatchObject({
      status: "rejected",
      detail: "principal_or_primary_lease_changed",
      retryable: false,
    });
  });

  it("surfaces mounted coordinator fail-closed errors without leaking or sending", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const sendSpy = vi.spyOn(AppStream, "sendMessage").mockImplementation(() => new Promise(() => {}));
    const { target, coordinator } = readyApp("focus");
    coordinator.consumeA4Handoff.mockRejectedValueOnce(new CoordinatorHttpError(
      503,
      `/api/review-sessions/${SESSION_ID}/a4-handoffs/${HANDOFF_ID}/consume`,
      "a4_authentic_lease_unavailable",
    ));

    await target._beginA4Handoff(SESSION_ID);

    expect(sendSpy).not.toHaveBeenCalled();
    expect(target.state.a4Handoff).toMatchObject({
      status: "rejected",
      detail: "a4_authentic_lease_unavailable",
      retryable: true,
    });
    const html = renderToString(target.render());
    expect(html).toContain('data-status="rejected"');
    expect(html).toContain("a4_authentic_lease_unavailable");
    expect(html).not.toContain("principal_carrier_a4");
    expect(html).not.toContain("lease_token_a4");
  });

  it.each(["pending", "succeeded", "rejected", "timed-out"] as const)("renders the %s state as machine-readable UI", (status) => {
    const { target } = readyApp("focus");
    target.state = {
      ...target.state,
      a4Handoff: {
        ...target.state.a4Handoff,
        status,
        phase: status === "pending" ? "command-pending" : "terminal",
        retryable: status === "rejected" || status === "timed-out",
      },
    };
    const html = renderToString(target.render());
    expect(html).toContain(`data-status="${status}"`);
  });
});
