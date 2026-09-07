// unified-console-runtime-truth slice 1（tasks 1.7）：頂列 GPU chip 綁 /api/runtime/status（盤點：無 GPU 欄位→「GPU 未取得」；
// 離線→「GPU —」；其他非 2xx→狀態碼）；Coordinator／Governance／Kit chip 與側欄轉檔 badge 亦為真值；殼層原始碼不含字面 82%。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { RT_IDLE, conversionRecord, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("UnifiedShell 頂列 chips 與側欄 badge（真值）", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  let root: Root | null;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div"); document.body.appendChild(container);
    prevHash = window.location.hash; root = null;
    coordinatorStatusStore.reset();
  });
  afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    document.body.removeChild(container); vi.restoreAllMocks(); window.location.hash = prevHash;
  });
  async function mountAt(hash: string) {
    window.location.hash = hash;
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;

  it("live：無 GPU 欄位 → 「GPU 未取得」unavailable；三 chip ok；badge＝running+failed", async () => {
    spyCoordinatorEndpoints({ conversionRecords: { count: 3, items: [conversionRecord("a", "converting"), conversionRecord("b", "failed"), conversionRecord("c", "ready")] } });
    await mountAt("#home");
    expect(uc("chip-gpu").textContent).toBe("GPU 未取得");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("unavailable");
    expect(uc("chip-coordinator").getAttribute("data-health")).toBe("ok");
    expect(uc("chip-coordinator").textContent).toContain("Coordinator OK");
    expect(uc("chip-governance").getAttribute("data-health")).toBe("ok");
    expect(uc("chip-kit").getAttribute("data-health")).toBe("ok");
    expect(uc("nav-pipe-badge").textContent).toBe("2");
    expect(uc("nav-pipe-badge").getAttribute("data-state")).toBe("live");
    expect(container.querySelector('[data-uc="page-root"]')).not.toBeNull();
    expect(container.innerHTML).not.toContain("82%");
  });

  it("offline（十端點 503）：「GPU —」offline；三 chip unknown＋未連線；badge —", async () => {
    spyCoordinatorEndpointsOffline();
    await mountAt("#home");
    expect(uc("chip-gpu").textContent).toBe("GPU —");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("offline");
    for (const id of ["chip-coordinator", "chip-governance", "chip-kit"]) {
      expect(uc(id).getAttribute("data-health"), id).toBe("unknown");
      expect(uc(id).textContent, id).toContain("未連線");
    }
    expect(uc("nav-pipe-badge").textContent).toBe("—");
    expect(uc("nav-pipe-badge").getAttribute("data-state")).toBe("offline");
  });

  it("#768：kit_runtime_health suspect → Kit chip degraded、顯示無首幀次數；/api/kit/health ok 不再遮蓋", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: {
        ...RT_IDLE,
        kit_runtime_health: [{
          kit_instance_id: "kit_local_001", media_state: "suspect", source: "viewer_lease_evidence",
          detail: "2 consecutive primary viewer leases had DataChannel ready but never a first frame",
          no_first_frame_streak: 2, qualifying_lease_count: 2, last_first_frame_at: null,
          evidence_lease_ids: ["viewer_lease_a", "viewer_lease_b"],
        }],
      },
    });
    await mountAt("#home");
    expect(uc("chip-kit").getAttribute("data-health")).toBe("degraded");
    expect(uc("chip-kit").textContent).toContain("無首幀×2");
    expect(uc("chip-kit").getAttribute("title")).toContain("kit_local_001");
    // coordinator 本身仍 ok；只有 Kit chip 被降級
    expect(uc("chip-coordinator").getAttribute("data-health")).toBe("ok");
  });

  it("#768：kit_runtime_health ok → Kit chip 維持 /api/kit/health 的 ok", async () => {
    spyCoordinatorEndpoints({
      runtimeStatus: {
        ...RT_IDLE,
        kit_runtime_health: [{
          kit_instance_id: "kit_local_001", media_state: "ok", source: "viewer_lease_evidence", detail: "frame seen",
          no_first_frame_streak: 0, qualifying_lease_count: 3, last_first_frame_at: "2026-09-07T09:50:36Z", evidence_lease_ids: ["viewer_lease_c"],
        }],
      },
    });
    await mountAt("#home");
    expect(uc("chip-kit").getAttribute("data-health")).toBe("ok");
    expect(uc("chip-kit").textContent).toContain("Kit Runtime OK");
  });

  it("error（runtime/status 500）：Coordinator chip degraded 顯示 500；GPU chip「GPU 500」", async () => {
    spyCoordinatorEndpoints({ runtimeStatus: new CoordinatorHttpError("/api/runtime/status", 500, "boom") });
    await mountAt("#home");
    expect(uc("chip-coordinator").getAttribute("data-health")).toBe("degraded");
    expect(uc("chip-coordinator").textContent).toContain("500");
    expect(uc("chip-gpu").textContent).toBe("GPU 500");
    expect(uc("chip-gpu").getAttribute("data-state")).toBe("error");
  });

  it("殼層原始碼不含字面 82%／GPU/Stream", () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "UnifiedShell.tsx"), "utf8");
    expect(src).not.toContain("82%");
    expect(src).not.toContain("GPU/Stream");
  });
});
