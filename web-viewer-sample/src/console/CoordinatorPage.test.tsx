import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";
import { CoordinatorPage } from "./pages";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

function runtimeStatus(): RuntimeStatus {
  const now = Date.now();
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: new Date(now).toISOString() },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "", handoff_path: "/" },
      conversion_authority: { base_url: "", authority: "" },
      kit: [],
    },
    sessions: {
      count: 2,
      active_count: 1,
      participant_count: 0,
      items: [
        {
          session_id: "review_session_green",
          status: "active",
          project_id: "p1",
          model_version_id: "v1",
          participant_count: 0,
          expected_stage_url: "omniverse://stage/main.usd",
          conversion_status: "ready",
          kit_instance_ids: ["kit_main"],
          created_at: new Date(now - 60_000).toISOString(),
          updated_at: new Date(now - 1_000).toISOString(),
          primary_viewer_lease_id: "lease_1",
          first_frame_at: new Date(now - 5_000).toISOString(),
          viewer_leases: [{
            lease_id: "lease_1",
            viewer_id: "viewer_1",
            user_id: "operator",
            display_name: "operator",
            role: "primary",
            status: "active",
            claimed_at: new Date(now - 10_000).toISOString(),
            last_heartbeat_at: new Date(now - 1_000).toISOString(),
            released_at: null,
            first_frame_at: new Date(now - 5_000).toISOString(),
            loaded_stage_url: "omniverse://stage/main.usd",
            datachannel_ready: true,
            stage_match: true,
          }],
        },
        {
          session_id: "review_session_created",
          status: "created",
          project_id: "p1",
          model_version_id: "v2",
          participant_count: 0,
          expected_stage_url: null,
          conversion_status: null,
          kit_instance_ids: [],
          created_at: new Date(now - 30_000).toISOString(),
          updated_at: new Date(now - 30_000).toISOString(),
        },
      ],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "asbuilt",
      note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5173 },
      host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] },
    },
  };
}

async function waitFor(assert: () => void, maxTicks = 30): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

describe("CoordinatorPage monitoring summary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    window.location.hash = "";
  });

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = "";
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  function render() {
    root = createRoot(container);
    act(() => { root.render(<CoordinatorPage />); });
  }

  it("顯示 runtime session count、evidence-green count 與 kit idle 狀態", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(runtimeStatus());
    vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockResolvedValue({
      instance_id: "kit_main",
      status: "idle",
      selected_artifact_ids: [],
      opened_runtime_uris: [],
      last_command: null,
      control_status: "idle",
    });

    render();

    await waitFor(() => {
      const summary = container.querySelector('[data-testid="rt-monitor-summary"]');
      expect(summary).not.toBeNull();
      expect(summary!.textContent).toContain("active 1");
      expect(summary!.textContent).toContain("queued 1");
      expect(summary!.textContent).toContain("kit_main · idle");
      expect(summary!.textContent).toContain("未取得");
      expect(summary!.textContent).toContain("1");
    });
  });

  it("kit 失敗時只在彙總顯示未取得，不阻斷 runtime session 摘要", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(runtimeStatus());
    vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockRejectedValue(new Error("kit unavailable"));

    render();

    await waitFor(() => {
      const summary = container.querySelector('[data-testid="rt-monitor-summary"]');
      expect(summary).not.toBeNull();
      expect(summary!.textContent).toContain("active 1");
      expect(summary!.textContent).toContain("queued 1");
      expect(summary!.textContent).toContain("未取得");
      expect(summary!.textContent).toContain("kit unavailable");
    });
  });
});
