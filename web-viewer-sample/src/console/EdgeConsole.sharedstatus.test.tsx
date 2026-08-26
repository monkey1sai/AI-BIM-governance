import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient } from "./coordinatorClient";
import { coordinatorStatusStore } from "./unified/coordinatorStatusStore";
import { RT_IDLE, spyCoordinatorEndpoints } from "./unified/__testdata__/coordinatorMocks";

// IA v2 雙殼：SharedStatusRail（含 SharedStatusProvider 的 5000ms 輪詢）是 legacy 殼專屬；
// approved 鍵 {home,a1..a10,pipeline,runtime} 走 UnifiedShell。
// unified-console-runtime-truth（5.1）：UnifiedShell 不再 fixture-first——#home 經共用 poller 呼叫 runtimeStatus，
// 殼層與 HomePage 同訂閱同一端點時仍只有一個 in-flight（同一輪恰一個請求）。
describe("EdgeConsole shared status polling（legacy rail 一次；unified 共用 poller 單一 in-flight）", () => {
  let container: HTMLDivElement;
  let prevHash: string;
  beforeEach(() => {
    (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    prevHash = window.location.hash;
    coordinatorStatusStore.reset();
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    window.location.hash = prevHash;
  });

  it("legacy 路由（#sessions）：renders the rail and polls runtimeStatus once for the whole console", async () => {
    window.location.hash = "#sessions";
    const spy = vi.spyOn(coordinatorClient, "runtimeStatus").mockResolvedValue(RT_IDLE);
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

  it("approved 路由（#home）：UnifiedShell 不渲染 rail；runtimeStatus 經共用 poller 恰呼叫一次（殼層＋Home 同訂閱＝單一 in-flight）", async () => {
    window.location.hash = "#home";
    const spies = spyCoordinatorEndpoints();
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); });

    // 確認真的渲染了 UnifiedShell（非空白誤判）：側欄 footer 簽名存在。
    expect(container.innerHTML).toContain(":8004/ui · UnifiedConsole");
    // approved 鍵不掛 SharedStatusRail（rail 是 legacy 殼專屬）。
    expect(container.querySelector('[data-testid="shared-status-rail"]')).toBeNull();
    // 共用 poller：同端點同一輪只有一個請求（殼層 SHELL_KEYS 與 HomePage 都訂閱 runtimeStatus）。
    expect(spies.runtimeStatus).toHaveBeenCalledTimes(1);
    expect(spies.getConversionRecords).toHaveBeenCalledTimes(1);
    expect(spies.getConversionRecords).toHaveBeenCalledWith(100);
    expect(spies.getCallbackOutboxSummary).toHaveBeenCalledWith(200);

    await act(async () => { root.unmount(); });
  });
});
