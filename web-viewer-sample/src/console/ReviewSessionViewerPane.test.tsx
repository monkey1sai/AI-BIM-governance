import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewerBox = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  renderCount: 0,
  sendHighlight: vi.fn(),
  sendFocus: vi.fn(),
  sendClear: vi.fn(),
}));

vi.mock("./EmbeddedViewer", () => ({
  EmbeddedViewer: forwardRef((props: Record<string, unknown>, ref) => {
    viewerBox.renderCount += 1;
    viewerBox.current = props;
    useImperativeHandle(ref, () => ({
      sendHighlight: viewerBox.sendHighlight,
      sendFocus: viewerBox.sendFocus,
      sendClear: viewerBox.sendClear,
    }));
    return <div data-testid="embedded-viewer-stub" />;
  }),
}));

import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { __resetLocalDevUserCarrierForTests, getLocalDevUserCarrier } from "./localDevPrincipal";
import { parseReviewRoomHandoff, ReviewSessionViewerPane, type ReviewRoomHandoff } from "./ReviewSessionViewerPane";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const handoff: ReviewRoomHandoff = {
  source: "a1",
  sessionId: "review_session_x",
  ruleRunId: "rr_a1",
  ifcGuid: "2O2Fr$t4X7Zf8NOew3FLOH",
  usdPrimPath: "/World/Door_001",
  ruleCode: "FIRE-RATING",
  severity: "error",
  label: "Fire rating missing",
  expectedStageUrl: "stage://x",
  mappingInformationStatus: null,
  mappingIssueCode: null,
  mappingIssueCount: null,
};

function fakeRuntimeStatus(): RuntimeStatus {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "", authority: "" },
      kit: [],
    },
    sessions: {
      count: 1,
      active_count: 1,
      participant_count: 0,
      items: [{
        session_id: "review_session_x",
        status: "active",
        project_id: "p1",
        model_version_id: "m1",
        participant_count: 0,
        expected_stage_url: "stage://x",
        expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
        conversion_status: null,
        kit_instance_ids: [],
        created_at: "",
        updated_at: "",
        first_frame_at: null,
      }],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "",
      note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] },
    },
  };
}

function fakePrimaryLease() {
  return {
    lease_id: "viewer_lease_primary",
    lease_token: "lease_token_primary",
    session_id: "review_session_x",
    viewer_id: "review_room_viewer_test",
    user_id: "review_room_operator_test",
    display_name: "Review Room primary viewer",
    role: "primary" as const,
    status: "active" as const,
    kit_instance_id: "kit_local_001",
    stream_config: {
      signalingServer: "127.0.0.1",
      signalingPort: 49100,
      mediaServer: "127.0.0.1",
      mediaPort: 47998,
    },
    client_nonce: "nonce",
    claimed_at: "2026-07-01T00:00:00.000Z",
    expires_at: "2026-07-01T00:00:45.000Z",
    last_heartbeat_at: null,
    released_at: null,
    first_frame_at: null,
    loaded_stage_url: null,
    datachannel_ready: false,
    stage_match: null,
    primary: true,
    heartbeat_after_ms: 15000,
    idempotent_replay: false,
  };
}

describe("ReviewSessionViewerPane", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    viewerBox.current = null;
    viewerBox.renderCount = 0;
    viewerBox.sendHighlight.mockClear();
    viewerBox.sendFocus.mockClear();
    viewerBox.sendClear.mockClear();
    __resetLocalDevUserCarrierForTests();
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(coordinatorClient, "claimViewerLease").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-07-01T00:00:00.000Z" });
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  const q = <T extends HTMLElement = HTMLElement>(tid: string) => container.querySelector<T>(`[data-testid="${tid}"]`);
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  };
  const renderPane = async (nextHandoff = handoff) => {
    root = createRoot(container);
    await act(async () => { root!.render(<ReviewSessionViewerPane handoff={nextHandoff} />); });
    await flush();
  };

  it("parses A1 handoff hash without secret fields", () => {
    const parsed = parseReviewRoomHandoff("#review?source=a1&rule_run_id=rr_a1&session=review_session_x&ifc_guid=g1&usd_prim_path=%2FWorld%2FDoor_001&rule_code=R1&mapping_information_status=incomplete&mapping_issue_code=ifc_usdc_mapping_information_incomplete&mapping_issue_count=1");
    expect(parsed.source).toBe("a1");
    expect(parsed.ruleRunId).toBe("rr_a1");
    expect(parsed.sessionId).toBe("review_session_x");
    expect(parsed.usdPrimPath).toBe("/World/Door_001");
    expect(parsed.mappingInformationStatus).toBe("incomplete");
    expect(parsed.mappingIssueCode).toBe("ifc_usdc_mapping_information_incomplete");
    expect(parsed.mappingIssueCount).toBe("1");
    expect(JSON.stringify(parsed)).not.toContain("lease_token");
  });

  it("mount shows handoff context but does not claim lease or mount viewer before manual start", async () => {
    await renderPane();

    expect(q<HTMLInputElement>("review-room-session-input")!.value).toBe("review_session_x");
    expect(q("review-room-handoff-summary")?.textContent).toContain("rr_a1");
    expect(q("review-room-kit-not-started")).not.toBeNull();
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
    expect(viewerBox.renderCount).toBe(0);
  });

  it("manual start claims primary lease and mounts the viewer", async () => {
    const sharedCarrier = getLocalDevUserCarrier();
    await renderPane();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledWith(
      "review_session_x",
      expect.objectContaining({
        requested_role: "primary",
      }),
      sharedCarrier,
    );
    const claimCall = vi.mocked(coordinatorClient.claimViewerLease).mock.calls[0];
    expect(claimCall[1]).not.toHaveProperty("user_id");
    expect(claimCall[2]).toBe(sharedCarrier);
    expect(q("review-room-viewer-host")).not.toBeNull();
    expect(viewerBox.renderCount).toBe(1);
    expect(viewerBox.current?.sessionId).toBe("review_session_x");
    expect(viewerBox.current?.viewerOrigin).toBe("http://127.0.0.1:5173");
  });

  it("empty session shows the dedicated no-session state with the session selector still actionable", async () => {
    await renderPane({ ...handoff, sessionId: "" });

    const note = q("review-room-no-session");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("尚未附掛 review session");
    expect(q<HTMLInputElement>("review-room-session-input")).not.toBeNull();
    expect(q("review-room-session-candidates")).not.toBeNull();
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(true);
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("a valid attached session does not show the no-session state", async () => {
    await renderPane();

    expect(q("review-room-no-session")).toBeNull();
  });

  it("missing viewer origin shows the origin-missing state with an actionable runtime refresh", async () => {
    const originless = fakeRuntimeStatus();
    originless.configured_endpoints.viewer.browser_url_base = "";
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValueOnce(originless as never);

    await renderPane();

    const note = q("review-room-viewer-origin-missing");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("viewer 入口");
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(true);
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();

    await act(async () => { q<HTMLButtonElement>("review-room-viewer-origin-refresh")!.click(); });
    await flush();

    expect(coordinatorClient.runtimeStatus).toHaveBeenCalledTimes(2);
    expect(q("review-room-viewer-origin-missing")).toBeNull();
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(false);
  });

  it("stale or missing runtime session is distinguishable and cannot be attached", async () => {
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue({
      ...fakeRuntimeStatus(),
      sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
    } as never);

    await renderPane();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_listed");
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("runtime/status");
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("shows stale artifact health and blocks mapping-dependent highlight before attach", async () => {
    const staleRuntime = fakeRuntimeStatus();
    staleRuntime.sessions.items[0] = {
      ...staleRuntime.sessions.items[0],
      artifact_health: {
        source_ifc_exists: true,
        model_usdc_reachable: true,
        mapping_reachable: false,
        metadata_reachable: null,
        all_required_ready: false,
        checked_at: "2026-07-07T10:00:00.000Z",
        stale_reason: "derived_artifact_unreachable",
        failure_details: { source_ifc: null, model_usdc: null, mapping: "http_404", metadata: null },
        source: "edge_health_probe",
      },
    };
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue(staleRuntime as never);

    await renderPane();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("mapping_reachable=false");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("derived_artifact_unreachable");
    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("mapping_reachable=false");
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("primary lease conflict has a stable occupied state and an actionable retry", async () => {
    vi.mocked(coordinatorClient.claimViewerLease).mockRejectedValueOnce(
      new Error("coordinator /api/review-sessions/review_session_x/viewer-leases/claim -> 409 primary_already_claimed"),
    );

    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    const occupied = q("review-room-lease-occupied");
    expect(occupied?.textContent).toContain("占用");
    // spec: SHALL NOT 顯示現任 holder user/viewer/display/nonce/stream detail
    expect(occupied?.textContent).not.toMatch(/lease_|viewer_|nonce|stream|display_name|holder/u);
    expect(q("review-room-lease-error")).toBeNull();
    expect(q("review-room-viewer-host")).toBeNull();
    expect(viewerBox.renderCount).toBe(0);

    await act(async () => { q<HTMLButtonElement>("review-room-lease-retry")!.click(); });
    await flush();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(q("review-room-lease-occupied")).toBeNull();
    expect(q("review-room-viewer-host")).not.toBeNull();
  });

  it("no first frame and stage mismatch have distinct highlight reasons", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("第一幀");

    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://wrong" });
    });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("stage 未對齊");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("DataChannel ready");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("stage truth");
  });

  it("first frame plus authority-confirmed matched stage enables Review Room highlight and records command trace", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("DataChannel ready");
    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledWith(
      "review_session_x",
      "viewer_lease_primary",
      "lease_token_primary",
      { first_frame: true, datachannel_ready: true },
    );

    await act(async () => {
      (viewerBox.current!.onStageLoaded as (m: unknown) => void)({
        protocol: "vg01",
        type: "stage_loaded",
        stageUrl: "stage://x",
        status: "active",
        binding_revision_id: "rev_binding_001",
      });
    });
    await flush();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("observed");
    const highlight = q<HTMLButtonElement>("review-room-highlight")!;
    expect(highlight.disabled).toBe(false);
    await act(async () => { highlight.click(); });

    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledWith("review_session_x", "viewer_lease_primary", "lease_token_primary", expect.objectContaining({
      loaded_stage_url: "stage://x",
      datachannel_ready: true,
    }));
    expect(coordinatorClient.reportFirstFrame).toHaveBeenCalledWith("review_session_x");
    expect(viewerBox.sendHighlight).toHaveBeenCalledWith([expect.objectContaining({
      ifc_guid: "2O2Fr$t4X7Zf8NOew3FLOH",
      rule_code: "FIRE-RATING",
    })]);
    expect(q("review-room-command-trace")?.textContent).toContain('"source": "review-room"');
    expect(q("review-room-command-trace")?.textContent).toContain("/World/Door_001");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("pending viewer ack");

    await act(async () => {
      (viewerBox.current!.onHighlightResult as (m: unknown) => void)({ protocol: "vg01", type: "highlight_result", requestId: "r1", ok: true });
    });
    await flush();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("已送出並收到 viewer 回報");

    await act(async () => {
      (viewerBox.current!.onStageLoaded as (m: unknown) => void)({
        protocol: "vg01",
        type: "stage_loaded",
        stageUrl: null,
        status: "unproven",
        binding_revision_id: "rev_binding_001",
      });
    });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-runtime-evidence")?.textContent).toContain("unproven");
    expect(q("review-room-runtime-evidence")?.getAttribute("aria-live")).toBe("polite");
    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenLastCalledWith(
      "review_session_x",
      "viewer_lease_primary",
      "lease_token_primary",
      { loaded_stage_url: null, datachannel_ready: true },
    );
  });

  it("manual session change clears active stage proof before a new claim", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
      (viewerBox.current!.onStageLoaded as (m: unknown) => void)({
        protocol: "vg01",
        type: "stage_loaded",
        stageUrl: "stage://x",
        status: "active",
        binding_revision_id: "rev_binding_001",
      });
    });
    await flush();
    expect(q("review-room-runtime-evidence")?.textContent).toContain("matched");

    const input = q<HTMLInputElement>("review-room-session-input")!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "review_session_other");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_observed");
    expect(q("review-room-runtime-evidence")?.textContent).not.toContain("matched");
    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-viewer-host")).toBeNull();
  });

  it("missing usd_prim_path opens Review Room diagnostic mode but blocks highlight", async () => {
    await renderPane({
      ...handoff,
      usdPrimPath: null,
      mappingInformationStatus: "incomplete",
      mappingIssueCode: "ifc_usdc_mapping_information_incomplete",
      mappingIssueCount: "1",
    });
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("usd_prim_path");
    expect(q("review-room-highlight-reason")?.textContent).toContain("ifc_usdc_mapping_information_incomplete");
    expect(q("review-room-handoff-summary")?.textContent).toContain("status=incomplete");
    expect(viewerBox.sendHighlight).not.toHaveBeenCalled();
  });
  it("a preparing session (status=created) is a distinct state and cannot be attached yet", async () => {
    const preparing = fakeRuntimeStatus();
    preparing.sessions.items[0] = { ...preparing.sessions.items[0], status: "created" };
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValueOnce(preparing as never);

    await renderPane();

    const note = q("review-room-session-preparing");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("created");
    expect(note?.getAttribute("role")).toBe("status");
    // preparing 必須與 not_listed（stale / 已關閉）分開，不得共用同一句診斷
    expect(note?.textContent).not.toContain("not_listed");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("preparing");
    expect(q("review-room-runtime-evidence")?.textContent).not.toContain("not_listed");
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    expect(q("review-room-highlight-reason")?.textContent).toContain("準備中");
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();

    await act(async () => { q<HTMLButtonElement>("review-room-session-preparing-refresh")!.click(); });
    await flush();

    expect(coordinatorClient.runtimeStatus).toHaveBeenCalledTimes(2);
    expect(q("review-room-session-preparing")).toBeNull();
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(false);
  });

  it("an active session is never reported as preparing", async () => {
    await renderPane();

    expect(q("review-room-session-preparing")).toBeNull();
    expect(q("review-room-runtime-evidence")?.textContent).toContain("observed");
  });

  it("a coordinator-terminal heartbeat rejection unmounts the viewer and shows the lease-expired state", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    expect(q("review-room-viewer-host")).not.toBeNull();

    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockRejectedValue(
      new Error("coordinator /api/review-sessions/review_session_x/viewer-leases/viewer_lease_primary/heartbeat -> 404 Viewer lease not found or token invalid."),
    );
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    const expired = q("review-room-lease-expired");
    expect(expired).not.toBeNull();
    expect(expired?.getAttribute("role")).toBe("alert");
    // 過期後不得繼續把舊畫面當成現行 session 的證據
    expect(q("review-room-viewer-host")).toBeNull();
    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_started");
    expect(q("review-room-runtime-evidence")?.textContent).not.toContain("viewer_lease_primary");

    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockResolvedValue(fakePrimaryLease() as never);
    await act(async () => { q<HTMLButtonElement>("review-room-lease-expired-reclaim")!.click(); });
    await flush();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(q("review-room-lease-expired")).toBeNull();
    expect(q("review-room-viewer-host")).not.toBeNull();
  });

  it("a non-terminal heartbeat rejection must not be escalated to lease-expired", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockRejectedValue(
      new Error("coordinator /api/review-sessions/review_session_x/viewer-leases/viewer_lease_primary/heartbeat -> 503 upstream unavailable"),
    );
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    expect(q("review-room-lease-expired")).toBeNull();
    expect(q("review-room-viewer-host")).not.toBeNull();
  });

  it("no first frame within the bounded budget becomes a visible timeout state, and retry takes a fresh viewer identity", async () => {
    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => { root!.render(<ReviewSessionViewerPane handoff={handoff} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(q("review-room-viewer-host")).not.toBeNull();
    expect(q("review-room-first-frame-timeout")).toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });

    const timedOut = q("review-room-first-frame-timeout");
    expect(timedOut).not.toBeNull();
    expect(timedOut?.getAttribute("role")).toBe("alert");
    // 只能主張「未觀察到」，不得替 Kit / GPU 端斷因
    expect(timedOut?.textContent).toContain("未觀察到");
    expect(q("review-room-highlight-reason")?.textContent).toContain("逾時");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_observed");

    const firstViewerId = (vi.mocked(coordinatorClient.claimViewerLease).mock.calls[0][1] as { viewer_id: string }).viewer_id;
    await act(async () => { q<HTMLButtonElement>("review-room-first-frame-retry")!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(coordinatorClient.releaseViewerLease).toHaveBeenCalledWith("review_session_x", "viewer_lease_primary", "lease_token_primary");
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    const secondViewerId = (vi.mocked(coordinatorClient.claimViewerLease).mock.calls[1][1] as { viewer_id: string }).viewer_id;
    expect(secondViewerId).not.toBe(firstViewerId);
    expect(q("review-room-first-frame-timeout")).toBeNull();
    vi.useRealTimers();
  });

  it("an observed first frame cancels the bounded timeout", async () => {
    vi.useFakeTimers();
    root = createRoot(container);
    await act(async () => { root!.render(<ReviewSessionViewerPane handoff={handoff} />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });

    expect(q("review-room-first-frame-timeout")).toBeNull();
    expect(q("review-room-viewer-host")).not.toBeNull();
    vi.useRealTimers();
  });
});
