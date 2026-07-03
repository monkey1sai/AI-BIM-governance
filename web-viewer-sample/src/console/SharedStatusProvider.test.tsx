import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedStatusProvider } from "./SharedStatusProvider";
import { useSharedStatus, type SharedStatusSnapshot } from "./useSharedStatus";
import { coordinatorClient, type RuntimeStatus } from "./coordinatorClient";

function rt(activeCount: number): RuntimeStatus {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "2026-07-03T00:00:00Z" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5173", handoff_path: "/" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "bim-streaming-server" },
      kit: [],
    },
    sessions: { count: 1, active_count: activeCount, participant_count: 0, items: [
      { session_id: "review_session_a", status: "active", project_id: "270", model_version_id: "v1", participant_count: 2, expected_stage_url: null, conversion_status: "ready", kit_instance_ids: [], created_at: "", updated_at: "" },
    ] },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: { classification: "demo", note: "", web_plane: { coordinator_port: 8004, viewer_port: 5173 }, host_native_plane: { conversion_api_base: "", kit_signal_ports: [], kit_media_ports: [] } },
  };
}

describe("SharedStatusProvider", () => {
  let container: HTMLDivElement;
  let captured: SharedStatusSnapshot | null;
  function Probe() { captured = useSharedStatus(); return null; }

  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container); captured = null;
  });
  afterEach(() => { document.body.removeChild(container); vi.restoreAllMocks(); vi.useRealTimers(); });

  it("polls runtimeStatus once per cycle and maps sessions + null GPU + designed-null stage_matched", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 2, items: [
      { idempotency_key: "k1", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
      { idempotency_key: "k2", project_id: "270", project_display_name: "270", category: "c", external_model_version_id: "v", conversion_job_id: null, status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "", updated_at: "" },
    ] });
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(statusSpy).toHaveBeenCalledTimes(1); // single poll, not per-child
    expect(captured?.activeSessions).toBe(1);
    expect(captured?.sessionsById["review_session_a"].participants).toBe(2);
    expect(captured?.sessionsById["review_session_a"].stage_matched).toBeNull();
    expect(captured?.gpuNodesTotal).toBeNull();
    expect(captured?.gpuNodesBusy).toBeNull();
    expect(captured?.health).toBe("ok");
    expect(captured?.conversionQueue).toBe(1); // only status ∈ {detected,queued,converting}
    expect(captured?.stale).toBe(false);
  });

  it("marks stale + unknown health when the poll fails", async () => {
    vi.spyOn(coordinatorClient, "runtimeStatus").mockRejectedValue(new Error("ECONNREFUSED"));
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); });
    expect(captured?.stale).toBe(true);
    expect(captured?.health).toBe("unknown");
  });

  it("uses an injected value and does not poll (test seam)", async () => {
    const statusSpy = vi.spyOn(coordinatorClient, "runtimeStatus");
    const fixture: SharedStatusSnapshot = { activeSessions: 5, sessionsById: {}, gpuNodesTotal: null, gpuNodesBusy: null, health: "ok", conversionQueue: null, updatedAt: "2026-07-03", stale: false };
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider value={fixture}><Probe /></SharedStatusProvider>); });
    expect(statusSpy).not.toHaveBeenCalled();
    expect(captured?.activeSessions).toBe(5);
  });

  it("keeps conversionQueue null when getConversionRecords fails though runtimeStatus succeeds (honest 未取得)", async () => {
    // Exercises the inner catch (records unavailable → do not guess): the runtimeStatus half must still
    // map, the outer poll must not crash into the failure branch, and conversionQueue must degrade to
    // null rather than a fabricated count. `conversionQueue === null` here is only reachable via that
    // catch (the success path always assigns a filtered number).
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(rt(1));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockRejectedValue(new Error("records 503"));
    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(captured?.conversionQueue).toBeNull();
    expect(captured?.activeSessions).toBe(1); // runtimeStatus half still mapped
    expect(captured?.health).toBe("ok");      // did not fall through to the outer catch
    expect(captured?.stale).toBe(false);      // a successful runtime poll is still fresh
  });

  it("flips stale once the last good poll is older than 2× the interval, even if no poll rejects (watchdog §5.2/§5.4)", async () => {
    // A request that hangs without ever rejecting (background-tab throttling / wedged socket) never
    // enters the catch, so stale would stay pinned false and expired data would be shown as fresh
    // (violates §5.4). The time-based watchdog must flip stale independently of whether a poll settled.
    vi.useFakeTimers();
    const hang = new Promise<RuntimeStatus>(() => {}); // never resolves, never rejects
    vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValueOnce(rt(1)).mockReturnValue(hang);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });

    const root = createRoot(container);
    await act(async () => { root.render(<SharedStatusProvider pollMs={1000}><Probe /></SharedStatusProvider>); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(captured?.stale).toBe(false); // first poll succeeded → last-known-good is fresh

    // Next cycle's request hangs; advance past 2× the interval with no poll ever settling.
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(captured?.stale).toBe(true);
  });
});
