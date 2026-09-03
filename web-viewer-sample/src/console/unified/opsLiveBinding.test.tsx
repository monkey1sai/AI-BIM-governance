// unified-console-runtime-truth slice 1（tasks 1.6）：#runtime 真值 OpsPage——Kit instance（GET /api/kit/instances/current）、
// GPU「未取得」（spec scenario「GPU 遙測未取得」）、服務健康六列、事件列誠實停用；不渲染任何固定 GPU／VRAM 數字。
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { CoordinatorHttpError, coordinatorClient } from "../coordinatorClient";
import { coordinatorStatusStore } from "./coordinatorStatusStore";
import { IDLE, spyCoordinatorEndpoints, spyCoordinatorEndpointsOffline } from "./__testdata__/coordinatorMocks";

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
  const typeInput = async (input: HTMLInputElement, value: string) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

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
    expect(uc("session-idle-policy-card").getAttribute("data-prov")).toBe("asbuilt");
    expect(uc("session-idle-policy-state").textContent).toBe("已啟用");
    expect(uc("session-idle-policy-value").textContent).toBe("30 分鐘");
    for (const lit of ["82%", "24%", "14.6/24 GB", "S-240601", "lease_8812", "OB-201", "cj_0117", "usd_viewer.kit"]) expect(pageRoot().innerHTML, lit).not.toContain(lit);
    expect(pageRoot().querySelector('[data-prov="fixture"]')).toBeNull();
  });

  it("operator 可用分鐘 preset 套用真實 policy；token 成功後從記憶體欄位清除", async () => {
    spyCoordinatorEndpoints();
    const update = vi.spyOn(coordinatorClient, "updateSessionIdlePolicy").mockResolvedValue({
      ...IDLE.sessionIdlePolicy,
      timeout_ms: 3_600_000,
      source: "operator_override",
      revision: 1,
    });
    await mountRuntime();
    await act(async () => { uc("session-idle-preset-60").click(); });
    const token = uc("session-idle-token") as HTMLInputElement;
    const reason = uc("session-idle-reason") as HTMLInputElement;
    await typeInput(token, "operator-secret");
    await typeInput(reason, "extend review window");
    await act(async () => { uc("session-idle-apply").click(); await Promise.resolve(); });
    expect(update).toHaveBeenCalledWith(
      3_600_000,
      0,
      IDLE.sessionIdlePolicy.process_epoch,
      "extend review window",
      "operator-secret",
    );
    expect(uc("session-idle-policy-value").textContent).toBe("60 分鐘");
    expect(uc("session-idle-feedback").getAttribute("role")).toBe("status");
    expect((uc("session-idle-token") as HTMLInputElement).value).toBe("");
  });

  it("mutation 失敗也清除 token，避免 credential 留在 DOM", async () => {
    spyCoordinatorEndpoints();
    vi.spyOn(coordinatorClient, "updateSessionIdlePolicy").mockRejectedValue(new Error("forbidden"));
    await mountRuntime();
    const token = uc("session-idle-token") as HTMLInputElement;
    await typeInput(token, "operator-secret");
    await typeInput(uc("session-idle-reason") as HTMLInputElement, "change policy");
    await act(async () => { uc("session-idle-apply").click(); await Promise.resolve(); });
    expect(uc("session-idle-feedback").getAttribute("role")).toBe("alert");
    expect(token.value).toBe("");
  });

  it("下一次 authoritative poll 覆蓋暫存成功值，包含 coordinator 重啟後 revision 歸零", async () => {
    spyCoordinatorEndpoints();
    vi.spyOn(coordinatorClient, "updateSessionIdlePolicy").mockResolvedValue({
      ...IDLE.sessionIdlePolicy,
      timeout_ms: 3_600_000,
      source: "operator_override",
      revision: 1,
    });
    await mountRuntime();
    await act(async () => { uc("session-idle-preset-60").click(); });
    await typeInput(uc("session-idle-token") as HTMLInputElement, "operator-secret");
    await typeInput(uc("session-idle-reason") as HTMLInputElement, "extend review window");
    await act(async () => { uc("session-idle-apply").click(); await Promise.resolve(); });
    expect(uc("session-idle-policy-value").textContent).toBe("60 分鐘");

    vi.mocked(coordinatorClient.getSessionIdlePolicy).mockResolvedValue({
      ...IDLE.sessionIdlePolicy,
      timeout_ms: 1_800_000,
      source: "environment",
      revision: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(uc("session-idle-policy-value").textContent).toBe("60 分鐘");
    expect((uc("session-idle-minutes") as HTMLInputElement).value).toBe("60");

    vi.mocked(coordinatorClient.getSessionIdlePolicy).mockResolvedValue({
      ...IDLE.sessionIdlePolicy,
      process_epoch: "22222222222222222222222222222222",
      timeout_ms: 1_800_000,
      source: "environment",
      revision: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });
    expect(uc("session-idle-policy-value").textContent).toBe("30 分鐘");
    expect((uc("session-idle-minutes") as HTMLInputElement).value).toBe("30");
  });

  it("未填 token 時拒絕送出並顯示可操作錯誤", async () => {
    spyCoordinatorEndpoints();
    const update = vi.spyOn(coordinatorClient, "updateSessionIdlePolicy");
    await mountRuntime();
    await act(async () => { uc("session-idle-apply").click(); });
    expect(update).not.toHaveBeenCalled();
    expect(uc("session-idle-feedback").getAttribute("role")).toBe("alert");
    expect(uc("session-idle-feedback").textContent).toContain("operator token");
  });

  it("offline（十一端點 503）：Kit／GPU 皆 —／offline；svc-dot 全 unknown；無 toast", async () => {
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
