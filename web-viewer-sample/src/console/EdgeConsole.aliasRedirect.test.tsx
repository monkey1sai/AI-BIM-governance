// web-viewer-sample/src/console/EdgeConsole.aliasRedirect.test.tsx
// #conv 已恢復為獨立既有-job 歷史頁；只有舊 #intake 維持 query-preserving alias → #minio。
import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdgeConsole from "./EdgeConsole";
import { coordinatorClient } from "./coordinatorClient";

describe("EdgeConsole：#conv 獨立頁與 #intake alias", () => {
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
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ count: 0, items: [] });
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

  it("renderToString #conv?job_id=J：渲染獨立 CV 頁且不改寫 hash", () => {
    window.location.hash = "#conv?job_id=J";
    let html = "";
    expect(() => {
      html = renderToString(<EdgeConsole />);
    }).not.toThrow();
    expect(html).toContain("<h1>IFC→USD 轉檔歷史</h1>");
    expect(window.location.hash).toBe("#conv?job_id=J");
  });

  it("DOM 掛載 #conv?job_id=J → 保持獨立頁與 query", async () => {
    window.location.hash = "#conv?job_id=J";
    const root = createRoot(container);
    await act(async () => {
      root.render(<EdgeConsole />);
    });
    await waitForHash("#conv?job_id=J");
    expect(container.querySelector('[data-testid="conv-page"]')).not.toBeNull();
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
