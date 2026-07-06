// web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx
// MD 三頁合一 Task 7（spec §5）：#conv / #intake → #minio 的 URL 重寫式 alias（repo 第一個）。
// 三條驗收（brief Step 1，逐字對應）：
//  (1) renderToString(<EdgeConsole/>) 於 hash="#conv?job_id=J"：純渲染不拋錯、輸出不含舊 CV 頁 h1
//      （AliasRedirect 回 null、useEffect 不跑 → 不導航；hash 保持不變）。
//  (2) DOM 掛載（createRoot + act）hash="#conv?job_id=J" → 重導 window.location.hash === "#minio?job_id=J"
//      （replace 保 query）。
//  (3) DOM 掛載 hash="#intake"（無 query）→ 重導 "#minio"。
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient } from "./coordinatorClient";

describe("EdgeConsole alias 重導：#conv / #intake → #minio（MD 合一 Task 7）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let prevActEnv: unknown;
  let prevHash: string;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    prevHash = window.location.hash;
    container = document.createElement("div");
    document.body.appendChild(container);
    // 重導成功後 usePageHash 會切到 #minio → ModelDataPage 掛載並抓四源資料（getMinioFolder /
    // getConversionRecords…）。stub 成空，讓測試聚焦「hash 是否被重寫」，不打真網路、不噴 loading 噪音。
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control",
      prefix: "",
      folders: [],
      objects: [],
      count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
  });
  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
    window.location.hash = prevHash;
  });

  // 輪詢 window.location.hash 直到等於預期（重導在 AliasRedirect useEffect 內同步 replace，通常
  // 首次 act flush 後即成立；迴圈為安全網並順帶 flush hashchange 觸發的 usePageHash re-render）。
  async function waitForHash(expected: string, timeout = 1000): Promise<void> {
    const start = Date.now();
    while (window.location.hash !== expected) {
      if (Date.now() - start > timeout) break;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(window.location.hash).toBe(expected);
  }

  it("renderToString #conv?job_id=J：不拋錯、輸出不含舊 CV 頁 h1（純渲染不觸發 useEffect → 不導航）", () => {
    window.location.hash = "#conv?job_id=J";
    let html = "";
    expect(() => {
      html = renderToString(<EdgeConsole />);
    }).not.toThrow();
    // 舊 CV 頁 h1（pages.tsx ConversionSchedulingPage:1036 `<h1>IFC→USD 轉檔排程</h1>`）不得出現——
    // alias 分支只回 null，不掛舊頁本體。
    expect(html).not.toContain("<h1>IFC→USD 轉檔排程</h1>");
    // 純渲染未導航：renderToString 不跑 useEffect，hash 仍停在 #conv（未被 replace）。
    expect(window.location.hash).toBe("#conv?job_id=J");
  });

  it("DOM 掛載 #conv?job_id=J → 重導 #minio?job_id=J（replace 保 query）", async () => {
    window.location.hash = "#conv?job_id=J";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#minio?job_id=J");
    await act(async () => {
      root.unmount();
    });
  });

  it("DOM 掛載 #intake（無 query）→ 重導 #minio", async () => {
    window.location.hash = "#intake";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#minio");
    await act(async () => {
      root.unmount();
    });
  });
});
