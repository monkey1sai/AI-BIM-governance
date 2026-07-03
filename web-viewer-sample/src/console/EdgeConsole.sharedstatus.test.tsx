import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

const RT: RuntimeStatus = {
  service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
  configured_endpoints: {
    coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
    viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
    conversion_authority: { base_url: "", authority: "" }, kit: [],
  },
  sessions: { count: 0, active_count: 0, participant_count: 0, items: [] },
  kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] },
  observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
};

describe("EdgeConsole mounts shared status rail once", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); window.location.hash = "#a1"; });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("renders the rail and polls runtimeStatus once for the whole console", async () => {
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.querySelector('[data-testid="shared-status-rail"]')).not.toBeNull();
    // A1 page also fetches runtimeStatus once on mount; the provider adds exactly one more. The rail must
    // not multiply polling per page — assert provider poll count stays bounded (<= 2: A1 mount + provider).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
