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

import { coordinatorClient } from "./coordinatorClient";
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

function fakeRuntimeStatus() {
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
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(fakeRuntimeStatus() as never);
    vi.spyOn(coordinatorClient, "claimViewerLease").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "viewerLeaseHeartbeat").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "releaseViewerLease").mockResolvedValue(fakePrimaryLease() as never);
    vi.spyOn(coordinatorClient, "reportFirstFrame").mockResolvedValue({ session_id: "review_session_x", first_frame_at: "2026-07-01T00:00:00.000Z" });
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
    await renderPane();

    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(coordinatorClient.claimViewerLease).toHaveBeenCalledWith("review_session_x", expect.objectContaining({ requested_role: "primary" }));
    expect(q("review-room-viewer-host")).not.toBeNull();
    expect(viewerBox.renderCount).toBe(1);
    expect(viewerBox.current?.sessionId).toBe("review_session_x");
    expect(viewerBox.current?.viewerOrigin).toBe("http://127.0.0.1:5173");
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

  it("lease conflict is shown as a distinct lease error and does not mount the viewer", async () => {
    vi.mocked(coordinatorClient.claimViewerLease).mockRejectedValue(new Error("409 lease conflict: primary already held"));

    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(q("review-room-lease-error")?.textContent).toContain("409 lease conflict");
    expect(q("review-room-viewer-host")).toBeNull();
    expect(viewerBox.renderCount).toBe(0);
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

  it("first frame plus matched stage enables Review Room highlight and records command trace", async () => {
    await renderPane();
    await act(async () => { q<HTMLButtonElement>("review-room-manual-start")!.click(); });
    await flush();

    expect(q<HTMLButtonElement>("review-room-highlight")!.disabled).toBe(true);
    await act(async () => {
      (viewerBox.current!.onFirstFrame as (m: unknown) => void)({ protocol: "vg01", type: "first_frame", stageUrl: "stage://x" });
    });
    await flush();

    expect(q("review-room-runtime-evidence")?.textContent).toContain("DataChannel ready");
    expect(q("review-room-runtime-evidence")?.textContent).toContain("observed");
    const highlight = q<HTMLButtonElement>("review-room-highlight")!;
    expect(highlight.disabled).toBe(false);
    await act(async () => { highlight.click(); });

    expect(coordinatorClient.viewerLeaseHeartbeat).toHaveBeenCalledWith("review_session_x", "viewer_lease_primary", "lease_token_primary", expect.objectContaining({
      first_frame: true,
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
});
