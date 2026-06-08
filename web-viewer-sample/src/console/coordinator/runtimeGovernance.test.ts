import { describe, expect, it } from "vitest";
import type { RuntimeStatus } from "../coordinatorClient";
import { buildEndpointRows, deriveClassicDashboard } from "./runtimeGovernance";

function makeRuntime(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    service: {
      status: "ok",
      name: "bim-review-coordinator",
      uptime_seconds: 120,
      generated_at: "2026-06-08T00:00:00.000Z",
    },
    configured_endpoints: {
      coordinator: {
        host: "127.0.0.1",
        port: 8004,
        public_host: "127.0.0.1",
        public_base_url: "http://127.0.0.1:8004",
      },
      viewer: {
        browser_url_base: "http://127.0.0.1:5173",
        handoff_path: "/ui/open",
      },
      conversion_authority: {
        base_url: "http://127.0.0.1:49101",
        authority: "bim-streaming-server",
      },
      kit: [
        {
          id: "kit-primary",
          signalingServer: "127.0.0.1",
          signalingPort: 49100,
          mediaServer: "127.0.0.1",
          mediaPort: 47998,
        },
        {
          id: "kit-spectator",
          signalingServer: "127.0.0.1",
          signalingPort: 49101,
          mediaServer: "127.0.0.1",
          mediaPort: 47999,
        },
      ],
    },
    sessions: {
      count: 0,
      active_count: 0,
      participant_count: 0,
      items: [],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: {
      count: 0,
      recent: [],
    },
    observations: {
      classification: "asbuilt",
      note: "runtime status summary",
      web_plane: {
        coordinator_port: 8004,
        viewer_port: 5173,
      },
      host_native_plane: {
        conversion_api_base: "http://127.0.0.1:49101",
        kit_signal_ports: [49100, 49101],
        kit_media_ports: [47998, 47999],
      },
    },
    ...overrides,
  };
}

describe("runtime governance helper", () => {
  it("null runtime -> red disconnected summary and no endpoint rows", () => {
    const dashboard = deriveClassicDashboard(null);

    expect(dashboard.overall.tone).toBe("red");
    expect(dashboard.overall.label).toContain("Runtime 無法連線");
    expect(buildEndpointRows(null)).toHaveLength(0);
  });

  it("ready Kit binding waits for browser first-frame evidence instead of occupied", () => {
    const runtime = makeRuntime({
      sessions: {
        count: 1,
        active_count: 1,
        participant_count: 1,
        items: [
          {
            session_id: "review_session_ready",
            status: "active",
            project_id: "project-1",
            model_version_id: "model-v1",
            participant_count: 1,
            expected_stage_url: "omniverse://localhost/Projects/model.usdc",
            conversion_status: "succeeded",
            kit_instance_ids: ["kit-primary"],
            created_at: "2026-06-08T00:00:00.000Z",
            updated_at: "2026-06-08T00:00:10.000Z",
          },
        ],
      },
      kit_instance_bindings: [
        {
          session_id: "review_session_ready",
          kit_instance_id: "kit-primary",
          status: "ready",
          assigned_artifact_ids: ["artifact-1"],
          started_at: "2026-06-08T00:00:03.000Z",
          last_heartbeat_at: "2026-06-08T00:00:09.000Z",
          released_at: null,
        },
      ],
    });

    const rows = buildEndpointRows(runtime);

    expect(rows[0]).toMatchObject({
      code: "PRI",
      endpointId: "PRI :49100",
      port: 49100,
      role: "primary",
      leaseState: "connected",
      sessionId: "review_session_ready",
      kitInstanceId: "kit-primary",
      firstFrame: "not_observed",
      heartbeat: "ok",
      stageTruth: "not_observed",
      readiness: "waiting_first_frame",
      nextAllowedAction: "Observe evidence",
    });
    expect(rows[0].businessStatus).toContain("等待第一幀畫面");
    expect(rows[0].technicalDetail).toContain("kit_instance=kit-primary");
    expect(rows[0].technicalDetail).toContain("media=127.0.0.1:47998");
    expect(rows[0].technicalDetail).toContain("session=review_session_ready");
  });

  it("active session without browser evidence produces yellow dashboard and honest missing evidence text", () => {
    const runtime = makeRuntime({
      sessions: {
        count: 1,
        active_count: 1,
        participant_count: 1,
        items: [
          {
            session_id: "review_session_ready",
            status: "active",
            project_id: "project-1",
            model_version_id: "model-v1",
            participant_count: 1,
            expected_stage_url: "omniverse://localhost/Projects/model.usdc",
            conversion_status: "succeeded",
            kit_instance_ids: ["kit-primary"],
            created_at: "2026-06-08T00:00:00.000Z",
            updated_at: "2026-06-08T00:00:10.000Z",
          },
        ],
      },
      kit_instance_bindings: [
        {
          session_id: "review_session_ready",
          kit_instance_id: "kit-primary",
          status: "ready",
          assigned_artifact_ids: ["artifact-1"],
          started_at: "2026-06-08T00:00:03.000Z",
          last_heartbeat_at: "2026-06-08T00:00:09.000Z",
          released_at: null,
        },
      ],
    });

    const dashboard = deriveClassicDashboard(runtime);

    expect(dashboard.overall.tone).toBe("yellow");
    expect(dashboard.overall.label).toContain("等待第一幀畫面");
    expect(dashboard.viewerEvidence.value).toBe("未取得 first-frame evidence");
    expect(dashboard.stageTruth.value).toBe("stage loaded 未觀測");
  });

  it("configured kit endpoints become PRI/SPC free rows without leases", () => {
    const rows = buildEndpointRows(makeRuntime());

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.code)).toEqual(["PRI", "SPC"]);
    expect(rows.map((row) => row.endpointId)).toEqual(["PRI :49100", "SPC :49101"]);
    expect(rows.map((row) => row.port)).toEqual([49100, 49101]);
    expect(rows.map((row) => row.role)).toEqual(["primary", "spectator"]);
    expect(rows.map((row) => row.leaseState)).toEqual(["free", "free"]);
    expect(rows.map((row) => row.sessionId)).toEqual(["—", "—"]);
    expect(rows.map((row) => row.heartbeat)).toEqual(["missing", "missing"]);
    expect(rows.map((row) => row.businessStatus)).toEqual(["可分配", "可分配"]);
    expect(rows.map((row) => row.nextAllowedAction)).toEqual(["Open primary URL", "Open spectator URL"]);
    expect(rows[0].technicalDetail).toContain("kit_instance=kit-primary");
    expect(rows[0].technicalDetail).toContain("media=127.0.0.1:47998");
    expect(rows[0].technicalDetail).toContain("session=—");
  });

  it("released Kit binding uses free-readiness evidence rules", () => {
    const runtime = makeRuntime({
      kit_instance_bindings: [
        {
          session_id: "review_session_released",
          kit_instance_id: "kit-primary",
          status: "released",
          assigned_artifact_ids: ["artifact-1"],
          started_at: "2026-06-08T00:00:03.000Z",
          last_heartbeat_at: null,
          released_at: "2026-06-08T00:00:20.000Z",
        },
      ],
    });

    const rows = buildEndpointRows(runtime);

    expect(rows[0]).toMatchObject({
      leaseState: "released",
      readiness: "free",
      firstFrame: "missing",
      heartbeat: "missing",
      businessStatus: "可分配",
    });
  });

  it("missing configured Kit endpoints is unhealthy instead of green idle", () => {
    const sample = makeRuntime();
    const runtime = makeRuntime({
      configured_endpoints: {
        ...sample.configured_endpoints,
        kit: [],
      },
    });

    const dashboard = deriveClassicDashboard(runtime);

    expect(buildEndpointRows(runtime)).toHaveLength(0);
    expect(dashboard.overall.tone).toBe("red");
    expect(dashboard.overall.label).toContain("未配置 Kit endpoint");
    expect(dashboard.overall.detail).toContain("Runtime endpoint 未觀測");
  });
});
