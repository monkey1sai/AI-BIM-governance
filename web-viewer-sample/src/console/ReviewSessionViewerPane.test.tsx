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
    vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockResolvedValue({ instance_id: "kit_local_001", status: "ready" } as never);
    // viewer iframe 掛載前必須先拿到 canonical trace carrier（stream-config 為權威來源）。
    vi.spyOn(coordinatorClient, "streamConfig").mockResolvedValue({
      session_id: "review_session_x",
      status: "active",
      trace_id: "rev_review_session_x",
    } as never);
  });

  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    if (container.parentNode) document.body.removeChild(container);
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
    const firstClientRequestId = viewerBox.sendHighlight.mock.calls[0][1] as string;

    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledWith("review_session_x", "viewer_lease_primary", "lease_token_primary", expect.objectContaining({
      loaded_stage_url: "stage://x",
      datachannel_ready: true,
    }));
    expect(coordinatorClient.reportFirstFrame).toHaveBeenCalledWith("review_session_x");
    expect(viewerBox.sendHighlight).toHaveBeenCalledWith([expect.objectContaining({
      ifc_guid: "2O2Fr$t4X7Zf8NOew3FLOH",
      rule_code: "FIRE-RATING",
    })], expect.any(String));
    expect(q("review-room-command-trace")?.textContent).toContain('"source": "review-room"');
    expect(q("review-room-command-trace")?.textContent).toContain("/World/Door_001");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("pending viewer ack");

    await act(async () => {
      root!.render(<ReviewSessionViewerPane handoff={{
        ...handoff,
        ifcGuid: "guid-door-002",
        usdPrimPath: "/World/Door_002",
      }} />);
    });
    await flush();

    expect(q("review-room-handoff-summary")?.textContent).toContain("/World/Door_002");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_sent");
    expect(q("review-room-command-trace")).toBeNull();

    const secondHighlight = q<HTMLButtonElement>("review-room-highlight")!;
    expect(secondHighlight.disabled).toBe(false);
    await act(async () => { secondHighlight.click(); });
    const secondClientRequestId = viewerBox.sendHighlight.mock.calls[1][1] as string;
    expect(secondClientRequestId).not.toBe(firstClientRequestId);

    await act(async () => {
      (viewerBox.current!.onHighlightResult as (m: unknown) => void)({
        protocol: "vg01", type: "highlight_result", requestId: "kit-old", clientRequestId: firstClientRequestId, ok: true,
      });
    });
    await flush();
    expect(q("review-room-runtime-evidence")?.textContent).toContain("pending viewer ack");

    await act(async () => {
      (viewerBox.current!.onHighlightResult as (m: unknown) => void)({
        protocol: "vg01", type: "highlight_result", requestId: "kit-current", clientRequestId: secondClientRequestId, ok: true,
      });
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

  // -------------------------------------------------------------------------
  // Task 5.6 slice 2: session-preparing / gpu-unavailable / lease-expired /
  // first-frame-timeout (spec: viewer SHALL 實作失敗態 visible-states 矩陣)
  // -------------------------------------------------------------------------

  it("session with a non-terminal conversion shows the session-preparing state with a pipeline action", async () => {
    const preparing = fakeRuntimeStatus();
    preparing.sessions.items[0] = { ...preparing.sessions.items[0], conversion_status: "running" };
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue(preparing as never);

    await renderPane();

    const note = q("review-room-session-preparing");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("running");
    expect(note?.querySelector('a[href="#pipeline"]')).not.toBeNull();
  });

  it("a terminal or absent conversion status does not show session-preparing", async () => {
    const done = fakeRuntimeStatus();
    done.sessions.items[0] = { ...done.sessions.items[0], conversion_status: "succeeded" };
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue(done as never);
    await renderPane();
    expect(q("review-room-session-preparing")).toBeNull();
  });

  it("a failed kit instances query shows gpu-unavailable, disables start, and links runtime", async () => {
    vi.mocked(coordinatorClient.kitInstanceCurrent).mockRejectedValue(
      new Error("coordinator /api/kit/instances/current -> 503"),
    );

    await renderPane();

    const note = q("review-room-gpu-unavailable");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("Kit runtime");
    expect(note?.querySelector('a[href="#runtime"]')).not.toBeNull();
    expect(q<HTMLButtonElement>("review-room-manual-start")!.disabled).toBe(true);
    expect(coordinatorClient.claimViewerLease).not.toHaveBeenCalled();
  });

  it("a heartbeat rejected as lease-not-found flips into the lease-expired state with a manual re-claim", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReviewSessionViewerPane handoff={handoff} heartbeatDelayFn={() => 30} />);
    });
    await flush();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    expect(q("review-room-viewer-host")).not.toBeNull();

    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockRejectedValue(
      new Error("coordinator /api/review-sessions/review_session_x/viewer-leases/viewer_lease_primary/heartbeat -> 404 Viewer lease not found or token invalid."),
    );
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    await flush();

    const note = q("review-room-lease-expired");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("過期");
    expect(q("review-room-viewer-host")).toBeNull();

    vi.mocked(coordinatorClient.viewerLeaseHeartbeat).mockResolvedValue(fakePrimaryLease() as never);
    await act(async () => { q<HTMLButtonElement>("review-room-lease-reclaim")!.click(); });
    await flush();
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(q("review-room-lease-expired")).toBeNull();
    expect(q("review-room-viewer-host")).not.toBeNull();
  });

  // #778 迴歸鎖（核心接線）：coordinator stream-config 給的 canonical trace 必須「原樣」抵達
  // iframe。用非 rev_ 前綴的 ifcready_ 值，讓「拿掉 traceId 透傳」或「改成前端合成
  // rev_${sessionId}」兩種退化都會紅——只在 EmbeddedViewer 層直接餵 traceId 的測試抓不到。
  it("stream-config 的 canonical trace 原樣傳到 viewer（ifcready_ 前綴不得被合成成 rev_）", async () => {
    vi.mocked(coordinatorClient.streamConfig).mockResolvedValue({
      session_id: "review_session_x",
      status: "active",
      trace_id: "ifcready_1788403854334_c383a04a",
    } as never);
    await renderPane();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(coordinatorClient.streamConfig).toHaveBeenCalledWith("review_session_x");
    expect(q("review-room-viewer-host")).not.toBeNull();
    expect(viewerBox.current?.traceId).toBe("ifcready_1788403854334_c383a04a");
    expect(viewerBox.current?.traceId).not.toBe("rev_review_session_x");
  });

  // #778 fail-closed：trace carrier 取不到就不掛 viewer。舊行為是掛一個必定 white-screen 的
  // iframe，operator 只會看到誤導的 first-frame 逾時。
  it("stream-config 失敗時顯示 trace-missing 警示且不掛 viewer", async () => {
    vi.mocked(coordinatorClient.streamConfig).mockRejectedValue(new Error("409 session trace authority unavailable"));
    await renderPane();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    const note = q("review-room-viewer-trace-missing");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("trace");
    expect(note?.textContent).toContain("409");
    expect(q("review-room-viewer-host")).toBeNull();
    expect(viewerBox.renderCount).toBe(0);
  });

  it("stream-config 回應缺 trace_id 時同樣 fail closed，不掛 viewer", async () => {
    vi.mocked(coordinatorClient.streamConfig).mockResolvedValue({
      session_id: "review_session_x",
      status: "active",
    } as never);
    await renderPane();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(q("review-room-viewer-trace-missing")).not.toBeNull();
    expect(q("review-room-viewer-host")).toBeNull();
    expect(viewerBox.renderCount).toBe(0);
  });

  // 逾時計時器必須綁「viewer 真的掛載」：有 lease 但沒 trace 時不得起算，否則又會把
  // 「iframe 根本沒掛上」誤報成「串流已建立但期限內未收到首幀」。
  it("有 lease 但缺 trace carrier 時不起 first-frame 逾時計時", async () => {
    vi.mocked(coordinatorClient.streamConfig).mockRejectedValue(new Error("409 session trace authority unavailable"));
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReviewSessionViewerPane handoff={handoff} firstFrameTimeoutMs={40} />);
    });
    await flush();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });

    expect(q("review-room-first-frame-timeout")).toBeNull();
    expect(q("review-room-viewer-trace-missing")).not.toBeNull();
  });

  // 換 session 時前一個 session 的 trace 不得洩到新 iframe（effect cleanup 的 alive 守衛）。
  it("切換 session 時延遲抵達的舊 trace 不得覆蓋新 session 的 trace", async () => {
    // 兩個 session 都要在 runtime status 內，否則 sessionObserved=false 就不會取 trace / claim。
    const twoSessions = fakeRuntimeStatus();
    twoSessions.sessions.items = [
      twoSessions.sessions.items[0],
      { ...twoSessions.sessions.items[0], session_id: "review_session_y" },
    ];
    twoSessions.sessions.count = 2;
    twoSessions.sessions.active_count = 2;
    vi.mocked(coordinatorClient.runtimeStatus).mockResolvedValue(twoSessions as never);
    vi.mocked(coordinatorClient.claimViewerLease).mockResolvedValue({
      ...fakePrimaryLease(),
      session_id: "review_session_y",
    } as never);

    let resolveFirst: ((value: unknown) => void) | null = null;
    vi.mocked(coordinatorClient.streamConfig).mockImplementation(((sessionId: string) => {
      if (sessionId === "review_session_x") {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ session_id: sessionId, status: "active", trace_id: `rev_${sessionId}` });
    }) as never);

    root = createRoot(container);
    await act(async () => { root!.render(<ReviewSessionViewerPane handoff={handoff} />); });
    await flush();

    await act(async () => { root!.render(<ReviewSessionViewerPane handoff={{ ...handoff, sessionId: "review_session_y" }} />); });
    await flush();

    // 舊 session 的請求現在才回來——必須被 cleanup 的 alive 守衛丟棄。
    await act(async () => {
      resolveFirst?.({ session_id: "review_session_x", status: "active", trace_id: "rev_review_session_x" });
      await Promise.resolve();
    });
    await flush();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(viewerBox.current?.sessionId).toBe("review_session_y");
    expect(viewerBox.current?.traceId).toBe("rev_review_session_y");
  });

  it("a claimed lease without a first frame inside the deadline shows first-frame-timeout with a retry", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReviewSessionViewerPane handoff={handoff} firstFrameTimeoutMs={40} />);
    });
    await flush();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    expect(q("review-room-first-frame-timeout")).toBeNull();

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

    const note = q("review-room-first-frame-timeout");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("首幀");
    expect(q<HTMLButtonElement>("review-room-first-frame-retry")).not.toBeNull();

    await act(async () => { q<HTMLButtonElement>("review-room-first-frame-retry")!.click(); });
    await flush();
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(2);
    expect(q("review-room-first-frame-timeout")).toBeNull();
  });

  it("an arriving first frame clears and prevents the first-frame-timeout state", async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(<ReviewSessionViewerPane handoff={handoff} firstFrameTimeoutMs={60} />);
    });
    await flush();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(q("review-room-first-frame-timeout")).toBeNull();
  });


  it("a viewer stream_state disconnect flips into the stream-disconnected state and a reconnect remounts the iframe", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();
    expect(q("review-room-stream-disconnected")).toBeNull();
    const mountsBefore = viewerBox.renderCount;

    await act(async () => {
      (viewerBox.current!.onStreamState as (m: unknown) => void)({ protocol: "vg01", type: "stream_state", state: "disconnected", kind: "stopped" });
    });
    await flush();

    const note = q("review-room-stream-disconnected");
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("串流中斷");
    // 誠實回退：不再顯示 streaming 證據，highlight 立即回封鎖。
    expect(q("review-room-runtime-evidence")?.textContent).toContain("not_observed");
    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);

    await act(async () => { q<HTMLButtonElement>("review-room-stream-reconnect")!.click(); });
    await flush();
    expect(q("review-room-stream-disconnected")).toBeNull();
    expect(viewerBox.renderCount).toBeGreaterThan(mountsBefore);
    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledTimes(1);
  });

  it("a fresh first frame clears the stream-disconnected state", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();
    await act(async () => {
      (viewerBox.current!.onStreamState as (m: unknown) => void)({ protocol: "vg01", type: "stream_state", state: "disconnected", kind: "terminated" });
    });
    await flush();
    expect(q("review-room-stream-disconnected")).not.toBeNull();
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();
    expect(q("review-room-stream-disconnected")).toBeNull();
  });

});
