// web-viewer-sample/src/console/CoordinatorCrossLinks.test.tsx
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoordinatorPage } from "./pages";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

const rt: RuntimeStatus = { service: { status: "ok", name: "c", uptime_seconds: 1, generated_at: "" }, configured_endpoints: { coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" }, viewer: { browser_url_base: "", handoff_path: "/" }, conversion_authority: { base_url: "", authority: "" }, kit: [] }, sessions: { count: 1, active_count: 1, participant_count: 0, items: [ { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 0, expected_stage_url: null, conversion_status: null, kit_instance_ids: [], created_at: "", updated_at: "" } ] }, kit_instance_bindings: [], ifc_ready_jobs: { count: 0, recent: [] }, observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } } };

describe("RT cross-link session panel", () => {
  let container: HTMLDivElement;
  beforeEach(() => { (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true; container = document.createElement("div"); document.body.appendChild(container); });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); });

  it("lists sessions with #sessions/#review/#instances chips carrying source=runtime", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt);
    const root = createRoot(container);
    await act(async () => { root.render(<CoordinatorPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector('[data-testid="rt-crosslinks"]')).not.toBeNull();
    const inst = container.querySelector('[data-testid="rt-link-instances-review_session_a"]') as HTMLButtonElement;
    expect(inst).not.toBeNull();
    await act(async () => { inst.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(window.location.hash).toContain("#instances?source=runtime");
  });
});
