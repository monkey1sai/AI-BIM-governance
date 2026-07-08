import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatorClient } from "./coordinatorClient";
import { KitGpuFleetPage } from "./pages";
import { SharedStatusProvider } from "./SharedStatusProvider";
import type { SharedStatusSnapshot } from "./useSharedStatus";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const snap: SharedStatusSnapshot = {
  activeSessions: 0,
  sessionsById: {},
  gpuNodesTotal: null,
  gpuNodesBusy: null,
  health: "ok",
  conversionQueue: null,
  updatedAt: "2026-07-08",
  stale: false,
};

async function waitFor(assert: () => void, maxTicks = 20): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

describe("KitGpuFleetPage live kit instance telemetry", () => {
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
    act(() => {
      root.render(<SharedStatusProvider value={snap}><KitGpuFleetPage /></SharedStatusProvider>);
    });
  }

  it("kit-manager 可用時顯示真 instance 狀態", async () => {
    vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockResolvedValue({
      instance_id: "kit_main",
      status: "open",
      selected_artifact_ids: [],
      opened_runtime_uris: ["omniverse://x"],
      last_command: "open",
      control_status: "sent",
    });

    render();

    await waitFor(() => {
      const panel = container.querySelector('[data-testid="kg-live-instance"]');
      expect(panel).not.toBeNull();
      expect(panel!.textContent).toContain("kit_main");
      expect(panel!.textContent).toContain("open");
      expect(panel!.textContent).toContain("sent");
      expect(panel!.textContent).toContain("omniverse://x");
      expect(panel!.textContent).toContain("GPU busy / total");
      expect(panel!.textContent).toContain("未取得");
    });
  });

  it("kit-manager 不可用時顯示未取得，不渲染假 edge-gpu 節點", async () => {
    vi.spyOn(coordinatorClient, "kitInstanceCurrent").mockRejectedValue(new Error("kit-manager down"));

    render();

    await waitFor(() => {
      const panel = container.querySelector('[data-testid="kg-live-instance"]');
      expect(panel).not.toBeNull();
      expect(panel!.textContent).toContain("未取得");
      expect(panel!.textContent).toContain("kit-manager down");
      expect(container.textContent).not.toContain("edge-gpu-01");
    });
  });
});
