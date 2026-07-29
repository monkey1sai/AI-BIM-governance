// UnifiedConsole workspace「完整工具 ↗」live 導流 chip（WorkspacePage → docks.tsx DockLiveLink）：
// mount 時唯讀 probe coordinatorClient.health()（3s timeout、任何失敗靜默）——
// 成功才在右欄 dock 標題列尾端渲染 chip（data-testid="dock-live-link"、data-prov="live"）；
// 離線/超時/例外 → 完全不渲染新 DOM（design gate 離線預設像素零變化鐵則）。
// 測試模式比照 EdgeConsole.sharedstatus.test.tsx：createRoot + act（renderToString 不跑
// effect，probe 驗證必須真 mount）+ 釘 hash（prevHash 還原）。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "../EdgeConsole";
import { coordinatorClient, type CoordinatorHealth } from "../coordinatorClient";

const HEALTH: CoordinatorHealth = { status: "ok", service: "bim-review-coordinator", kit_signaling_port: 49100 };

/** fixture dock → 真實工具 hash（A4 is a non-operable canonical redirect). */
const EXPECTED_HREF: Record<string, string> = {
  a1: "#a1-workbench",
  a2: "#version-diff",
  a3: "#federation",
  issues: "#issues",
};

describe("workspace dock live link（health probe 導流 chip）", () => {
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
    vi.unstubAllGlobals();
    window.location.hash = prevHash;
  });

  /** 釘 hash → createRoot mount <EdgeConsole/> → flush 數個 microtask 讓 probe promise 落定。 */
  async function mountAt(hash: string) {
    window.location.hash = hash;
    const root = createRoot(container);
    await act(async () => { root.render(<EdgeConsole />); });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    return root;
  }

  it("(a) 預設離線（fetch 失敗 stub）：workspace 正常渲染且無 dock-live-link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed (offline)")));
    const root = await mountAt("#a1");
    // 殼層本體照常渲染（非空白誤判）。
    expect(container.querySelector('[data-uc="dock-tab-a1"]')).not.toBeNull();
    // 像素零變化鐵則：離線不渲染任何新 DOM。
    expect(container.querySelector('[data-testid="dock-live-link"]')).toBeNull();
    await act(async () => { root.unmount(); });
  });

  it("(b) health 成功 stub：fixture dock chip 導向正確；A4 只導向 canonical live surface", async () => {
    const spy = vi.spyOn(coordinatorClient, "health").mockResolvedValue(HEALTH);
    const root = await mountAt("#a1");
    expect(spy).toHaveBeenCalledTimes(1); // probe 只在 mount 打一次，切 dock 不重打。
    for (const dock of ["a1", "a2", "a3", "issues"]) {
      await act(async () => {
        container.querySelector(`[data-uc="dock-tab-${dock}"]`)!
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const links = container.querySelectorAll('[data-testid="dock-live-link"]');
      expect(links.length, dock).toBe(1); // 每個 dock 恰一顆 chip。
      const link = links[0];
      expect(link.getAttribute("href"), dock).toBe(EXPECTED_HREF[dock]);
      expect(link.getAttribute("data-prov"), dock).toBe("live");
      expect(link.textContent, dock).toBe("完整工具 ↗");
    }
    await act(async () => {
      container.querySelector('[data-uc="dock-tab-a4"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="dock-live-link"]')).toBeNull();
    expect(container.querySelector('[data-uc="a4-canonical-link"]')?.getAttribute("href"))
      .toBe("#workspace?dock=a4");
    await act(async () => { root.unmount(); });
  });

  it("(c) probe 例外（health 同步 throw）：頁面不炸、無 chip", async () => {
    vi.spyOn(coordinatorClient, "health").mockImplementation(() => { throw new Error("boom"); });
    const root = await mountAt("#a2");
    // 頁面照常渲染（dock tabs + DATACHANNEL 字條存在）。
    expect(container.querySelector('[data-uc="dock-tab-a2"]')).not.toBeNull();
    expect(container.innerHTML).toContain("DataChannel");
    expect(container.querySelector('[data-testid="dock-live-link"]')).toBeNull();
    await act(async () => { root.unmount(); });
  });
});
