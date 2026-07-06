// web-viewer-sample/src/console/modelData/useMinioFolder.test.ts
// Task 9 review fix：folder cache / SSE dirty-signal 行為守衛。三條斷言遷移自被刪的
// MinioDataPage.test.tsx（[cache]×2 + [sse]×1，原文見 git show 04e66d6:.../MinioDataPage.test.tsx）——
// 行為本體已於 Task 3 抽入本 hook（folderCacheRef / refreshCurrent / SSE effect + stalePrefixes），
// 刪舊檔時漏遷，此處以 hook 層等價斷言補齊：
//  [cache1] 已載入 prefix 重訪（進/退資料夾）命中快取，不重打 getMinioFolder。
//  [cache2] refreshCurrent 繞過快取，呼叫帶 { refresh: true }（wire 上即 refresh=1）。
//  [sse]    minio.changed dirty event → stalePrefixes 含該 prefix；refreshCurrent 後重打 API 並清除 stale。
// 掛載沿用同目錄 useConversionData.test.ts 的 createRoot + act 小 harness（本 repo 未裝 renderHook）；
// 斷言一律走 waitFor 輪詢（禁同步斷言，flaky 前科：minio-watcher-loop）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinioFolder, type MinioFolderState } from "./useMinioFolder";
import { coordinatorClient, type MinioFolderListing } from "../coordinatorClient";

// MockEventSource：原樣搬自被刪的 MinioDataPage.test.tsx（addEventListener/removeEventListener/close/emit）。
class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  closed = false;
  private listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

// waitFor：輪詢直到斷言成立（同 useConversionData.test.ts pattern）。
async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const rootListing: MinioFolderListing = {
  bucket: "bim-control", prefix: "",
  folders: [{ prefix: "洲際好宅/", has_source_ifc: false }],
  objects: [], count: 0,
};
const subListing: MinioFolderListing = {
  bucket: "bim-control", prefix: "洲際好宅/", folders: [], objects: [], count: 0,
};

describe("useMinioFolder（folder cache / SSE dirty signal，遷自 MinioDataPage.test.tsx）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let root: Root;
  let prevActEnv: unknown;
  let prevEventSource: unknown;
  // harness 把 hook 每次 render 的回傳值寫進外部變數（沒有 renderHook 的替代掛載法）。
  let latest: MinioFolderState | null;
  function Harness() {
    latest = useMinioFolder();
    return null;
  }

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    // 預設關 SSE（effect 依 typeof EventSource early-return）；[sse] 測試自行換成 MockEventSource。
    prevEventSource = (globalThis as Record<string, unknown>).EventSource;
    (globalThis as Record<string, unknown>).EventSource = undefined;
    MockEventSource.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latest = null;
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
    if (prevEventSource === undefined) {
      delete (globalThis as Record<string, unknown>).EventSource;
    } else {
      (globalThis as Record<string, unknown>).EventSource = prevEventSource;
    }
  });

  it("[cache1] 已載入 prefix 進/退資料夾命中快取，不重打 getMinioFolder", async () => {
    const spy = vi.spyOn(coordinatorClient, "getMinioFolder")
      .mockImplementation(async (p?: string) => (p === "洲際好宅/" ? subListing : rootListing));
    await act(async () => { root.render(createElement(Harness)); });
    // mount → 載入根層（1 打）
    await waitFor(() => { expect(latest!.folder?.prefix).toBe(""); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenNthCalledWith(1, "");

    // 進資料夾（首次）→ 2 打
    await act(async () => { latest!.navigate("洲際好宅/"); });
    await waitFor(() => { expect(latest!.folder?.prefix).toBe("洲際好宅/"); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(2, "洲際好宅/");

    // 退回根層（重訪）→ 命中快取不重打，且 folder 真的換回根層資料（非只是不打）
    await act(async () => { latest!.navigate(""); });
    await waitFor(() => { expect(latest!.folder?.prefix).toBe(""); });
    expect(spy).toHaveBeenCalledTimes(2);

    // 再進同一資料夾（重訪）→ 仍命中快取
    await act(async () => { latest!.navigate("洲際好宅/"); });
    await waitFor(() => { expect(latest!.folder?.prefix).toBe("洲際好宅/"); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("[cache2] refreshCurrent 繞過快取重打，呼叫帶 { refresh: true }", async () => {
    const spy = vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(rootListing);
    await act(async () => { root.render(createElement(Harness)); });
    await waitFor(() => { expect(latest!.folder?.prefix).toBe(""); });
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => { latest!.refreshCurrent(); });
    await waitFor(() => { expect(spy).toHaveBeenCalledTimes(2); });
    expect(spy).toHaveBeenLastCalledWith("", { refresh: true });
  });

  it("[sse] minio.changed dirty event → stalePrefixes 含該 prefix；refreshCurrent 後重打 API 並清除 stale", async () => {
    (globalThis as Record<string, unknown>).EventSource = MockEventSource;
    const spy = vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue(rootListing);
    await act(async () => { root.render(createElement(Harness)); });
    await waitFor(() => { expect(latest!.folder?.prefix).toBe(""); });
    // SSE 訂閱真的建立且指向 coordinator 事件端點
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain("/api/minio/events");

    // dirty event → 目前 prefix 標 stale（UI 由 MinioTreePane 讀 stalePrefixes 顯示 minio-stale-note）
    await act(async () => {
      MockEventSource.instances[0].emit("minio.changed", {
        type: "minio.changed",
        prefixes: [""],
        reason: "minio-watcher-observed-object",
        at: "2026-07-01T00:00:00.000Z",
      });
    });
    await waitFor(() => { expect(latest!.stalePrefixes.has("")).toBe(true); });

    // 點重新整理（refreshCurrent）→ 重打 API（refresh:true）且 stale 標記清除
    await act(async () => { latest!.refreshCurrent(); });
    await waitFor(() => {
      expect(spy).toHaveBeenLastCalledWith("", { refresh: true });
      expect(latest!.stalePrefixes.has("")).toBe(false);
    });
  });
});
