// web-viewer-sample/src/console/modelData/MinioTreePane.test.tsx
// MD 三頁合一 Task 3：左欄檔案樹 MinioTreePane（受控純呈現）＋ useMinioFolder（folder 抓取/快取/SSE）。
// 斷言分三組（brief §Step 1）：
//  (a) 遷移自 MinioDataPage.test.tsx：資料夾以 localeCompare("zh-TW") 排序、has_source_ifc badge 存在/不存在。
//  (b) 新：selectedKey 命中的 source_ifc 物件檔名鈕帶 data-selected="true"（反白樣式鉤子）。
//  (c) 新：點 source_ifc 檔名鈕 → props.onSelect(obj) 被呼叫、收到完整 MinioObject。
// 掛載沿用同目錄 useConversionData.test.ts 的 createRoot + act + 本地 waitFor 小 harness（本 repo 未裝
// @testing-library）。斷言一律走 waitFor 輪詢（禁同步斷言，flaky 前科：minio-watcher-loop）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioTreePane } from "./MinioTreePane";
import { useMinioFolder } from "./useMinioFolder";
import { coordinatorClient, type ConversionRecord, type MinioObject } from "../coordinatorClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

const ifcObj: MinioObject = {
  key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc",
  etag: "abc", role: "source_ifc", idempotency_key: "mw_aaaa0000bbbb0001",
  project_id: "mv_1a2b3c4d", project_display_name: "東勢區許良宇紀念圖書館", category: "main", version: "000001",
};

// waitFor：輪詢直到斷言成立（同 useConversionData.test.ts pattern）。每輪包一次 act flush 一個
// microtask + 觸發重繪；斷言通過即返回，達上限仍不過才拋最後一次 AssertionError。
async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// harness：呼 useMinioFolder() 餵給 MinioTreePane（受控純呈現）；殼層（Task 6）之外的 props 以測試值注入。
function Harness(props: {
  records?: ConversionRecord[];
  recordsIncomplete?: boolean;
  selectedKey?: string | null;
  onSelect?: (obj: MinioObject) => void;
}) {
  const fs = useMinioFolder();
  return createElement(MinioTreePane, {
    fs,
    records: props.records ?? [],
    recordsIncomplete: props.recordsIncomplete ?? false,
    selectedKey: props.selectedKey ?? null,
    onSelect: props.onSelect ?? (() => {}),
  });
}

describe("MinioTreePane（MD 三頁合一 Task 3 左欄檔案樹）", () => {
  let container: HTMLDivElement;
  let root: Root;
  let prevActEnv: unknown;
  let prevEventSource: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    // SSE effect 依 typeof EventSource：測試環境設 undefined → effect early-return，不起真連線。
    prevEventSource = (globalThis as Record<string, unknown>).EventSource;
    (globalThis as Record<string, unknown>).EventSource = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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

  it("(a) 遷移：folders 依 localeCompare('zh-TW') 排序顯示（逆序輸入 → DOM 按 zh-TW 重排）", async () => {
    // 後端 S3 回 CommonPrefixes 為 UTF-8 byte order（非中文 collation）；前端對中文使用者以
    // localeCompare('zh-TW') 重排。三個資料夾刻意以「非 zh-TW 排序」順序輸入，斷言 DOM 出現順序＝排序後順序。
    const inputPrefixes = ["洲際好宅/", "東勢區許良宇紀念圖書館/", "annotations/"];
    const expectedOrder = [...inputPrefixes].sort((a, b) => a.localeCompare(b, "zh-TW"));
    expect(inputPrefixes).not.toEqual(expectedOrder); // 前提：輸入順序 ≠ zh-TW 排序（否則證不到排序）
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: inputPrefixes.map((p) => ({ prefix: p, has_source_ifc: false })),
      objects: [], count: 0,
    });
    await act(async () => { root.render(createElement(Harness, {})); });
    await waitFor(() => {
      const text = container.textContent ?? "";
      const positions = expectedOrder.map((p) => text.indexOf(p));
      expect(positions.every((pos) => pos >= 0)).toBe(true);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });
  });

  it("(a) 遷移：資料夾（遞迴）含 .ifc → 顯 badge；不含則不顯（testid 精準定位）", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [
        { prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true },
        { prefix: "annotations/", has_source_ifc: false },
      ],
      objects: [], count: 0,
    });
    await act(async () => { root.render(createElement(Harness, {})); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="minio-folder-badge-東勢區許良宇紀念圖書館/"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="minio-folder-badge-annotations/"]')).toBeNull();
      expect(container.textContent).toContain("含 source IFC");
    });
  });

  it("(b) 新：selectedKey 命中的 source_ifc 物件檔名鈕帶 data-selected=\"true\"；未命中為 false", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/",
      folders: [], objects: [ifcObj], count: 1,
    });
    await act(async () => {
      root.render(createElement(Harness, { selectedKey: ifcObj.key }));
    });
    await waitFor(() => {
      const btn = container.querySelector('[data-testid="md-tree-select-mw_aaaa0000bbbb0001"]');
      expect(btn).toBeTruthy();
      expect(btn?.getAttribute("data-selected")).toBe("true");
    });
    // 對照：未命中（selectedKey=null）→ data-selected 非 "true"（反白只落在命中列）。
    await act(async () => { root.render(createElement(Harness, { selectedKey: null })); });
    await waitFor(() => {
      const btn = container.querySelector('[data-testid="md-tree-select-mw_aaaa0000bbbb0001"]');
      expect(btn).toBeTruthy();
      expect(btn?.getAttribute("data-selected")).not.toBe("true");
    });
  });

  it("(c) 新：點 source_ifc 檔名鈕 → props.onSelect(obj) 被呼叫、收到完整 MinioObject", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/",
      folders: [], objects: [ifcObj], count: 1,
    });
    const onSelect = vi.fn();
    await act(async () => { root.render(createElement(Harness, { onSelect })); });
    let btn: HTMLButtonElement | null = null;
    await waitFor(() => {
      btn = container.querySelector('[data-testid="md-tree-select-mw_aaaa0000bbbb0001"]');
      expect(btn).toBeTruthy();
    });
    await act(async () => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(ifcObj);
  });
});
