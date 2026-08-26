// unified-console-runtime-truth slice 1（tasks 1.6）：#runtime 真值 OpsPage——Kit instance（GET /api/kit/instances/current）、
// GPU「未取得」（spec scenario「GPU 遙測未取得」）、服務健康六列、事件列誠實停用；不渲染任何固定 GPU／VRAM 數字。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

describe("OpsPage 真值綁定", () => {
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
  async function mountRuntime() {
    window.location.hash = "#runtime";
    root = createRoot(container);
    await act(async () => { root!.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });
  }
  const uc = (id: string) => container.querySelector<HTMLElement>(`[data-uc="${id}"]`)!;
  const pageRoot = () => container.querySelector<HTMLElement>('[data-uc="page-root"]')!;

  it("live：kit_local_001 idle；GPU 未取得（unavailable，非錯誤）；六 svc-dot；事件列 disabled＋原因；無固定數字", async () => {
    spyCoordinatorEndpoints();
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("kit_local_001");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("live");
    expect(uc("kit-instance-state").textContent).toBe("idle");
    expect(uc("kit-instance-detail").textContent).toBe("control not_sent · last — · opened 0");
    expect(uc("gpu-val").textContent).toBe("未取得");
    expect(uc("gpu-val").getAttribute("data-state")).toBe("unavailable");
    expect(uc("gpu-val").getAttribute("data-prov")).toBe("asbuilt");
    expect(uc("gpu-sub").textContent).toContain("GPU 使用率欄位");
    expect(container.querySelectorAll('[data-uc="svc-dot"]').length).toBe(6);
    expect(uc("events-disabled").getAttribute("aria-disabled")).toBe("true");
    expect(uc("events-disabled").getAttribute("data-action")).toBe("disabled");
    expect(uc("events-disabled").getAttribute("data-prov")).toBe("p1");
    expect(uc("events-disabled").getAttribute("aria-describedby")).toBe("events-reason");
    expect(container.querySelector("#events-reason")!.textContent).toContain("#instances");
    expect(uc("to-instances").getAttribute("href")).toBe("#instances");
    expect(uc("to-gpu").getAttribute("href")).toBe("#gpu");
    for (const lit of ["82%", "24%", "14.6/24 GB", "S-240601", "lease_8812", "OB-201", "cj_0117", "usd_viewer.kit"]) expect(pageRoot().innerHTML, lit).not.toContain(lit);
    expect(pageRoot().querySelector('[data-prov="fixture"]')).toBeNull();
  });

  it("offline（十端點 503）：Kit／GPU 皆 —／offline；svc-dot 全 unknown；無 toast", async () => {
    spyCoordinatorEndpointsOffline();
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("—");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("offline");
    expect(uc("gpu-val").textContent).toBe("—");
    expect(uc("gpu-val").getAttribute("data-state")).toBe("offline");
    expect(container.querySelectorAll('[data-uc="svc-dot"][data-health="unknown"]').length).toBe(6);
    expect(container.querySelector('[data-uc="toast"]')).toBeNull();
  });

  it("error：kit instance 404 → 顯示 404（error）與後端訊息，不顯示 running／固定 stage", async () => {
    spyCoordinatorEndpoints({ kitInstance: new CoordinatorHttpError("/api/kit/instances/current", 404, "no current instance") });
    await mountRuntime();
    expect(uc("kit-instance-id").textContent).toBe("404");
    expect(uc("kit-instance-id").getAttribute("data-state")).toBe("error");
    expect(uc("kit-instance-detail").textContent).toContain("no current instance");
    expect(pageRoot().innerHTML).not.toContain("running");
  });
});
