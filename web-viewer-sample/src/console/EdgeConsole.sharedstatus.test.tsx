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

// IA v2 雙殼：SharedStatusRail（含 SharedStatusProvider 的 5000ms 輪詢）是 legacy 殼專屬；
// approved 鍵 {home,a1..a10,conv,runtime} 走 UnifiedShell（fixture-first，不打 /api、不掛 rail）。
// 原本用 #a1 驗 rail，#a1 現已讓位給 UnifiedConsole workspace → 改用 legacy 路由 #sessions。
describe("EdgeConsole mounts shared status rail once (legacy shell only)", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = prevHash;
  });

  it("legacy 路由（#sessions）：renders the rail and polls runtimeStatus once for the whole console", async () => {
    window.location.hash = "#sessions";
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(container.querySelector('[data-testid="shared-status-rail"]')).not.toBeNull();
    // SessionManagementPage also fetches runtimeStatus once on mount; the provider adds exactly one
    // more. The rail must not multiply polling per page — assert provider poll count stays bounded
    // (<= 2: page mount + provider).
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);

    await act(async () => { root.unmount(); });
  });

  it("approved 路由（#home）：UnifiedShell 不渲染 rail、也不啟動 runtimeStatus 輪詢", async () => {
    window.location.hash = "#home";
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // 確認真的渲染了 UnifiedShell（非空白誤判）：側欄 footer 簽名存在。
    expect(container.innerHTML).toContain(":8004/ui · UnifiedConsole");
    // approved 鍵不掛 SharedStatusRail（rail 是 legacy 殼專屬）。
    expect(container.querySelector('[data-testid="shared-status-rail"]')).toBeNull();
    // UnifiedConsole fixture-first：不打 /api/runtime/status。
    expect(spy).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
  });
});
