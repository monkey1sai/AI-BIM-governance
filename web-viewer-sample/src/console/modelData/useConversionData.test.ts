// web-viewer-sample/src/console/modelData/useConversionData.test.ts
// MD 三頁合一 Task 2：資料層 hook useConversionData 的核心行為守衛。
// 三條核心斷言（誠實鐵律）：
//  1) listIfcReady 截斷（count > items.length）→ jobsTruncated=true、jobsLoaded=true（settle 過）。
//  2) getConversionRecords reject → recErr 非 null、recordsIncomplete=true、recordsLoaded=true（settle 過）。
//  3) minioWatchStatus reject 不污染 jobs → jobs 有值、mwErr 非 null、load() 回 { jobsOk:true, mwOk:false }。
// 掛載方式沿用同目錄鄰近測試（ConversionSchedulingPage.test.tsx / incomingHandoff.test.tsx）的
// createRoot + act 小 harness 元件模式（本 repo 未裝 @testing-library/react 的 renderHook）。
// 斷言一律走 waitFor 輪詢等 settle（禁同步斷言，flaky 前科：minio-watcher-loop）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversionData, type ConversionData } from "./useConversionData";
import { coordinatorClient, type IfcReadyListItem } from "../coordinatorClient";

// 沿用 ConversionSchedulingPage.test.tsx 的 okJob fixture 形狀（滿足 IfcReadyListItem 全 required key）。
const okJob: IfcReadyListItem = {
  project_id: "271", download_status: "downloaded", conversion_authority: null,
  review_session_id: null, viewer_url: null, expected_stage_url: null,
  expected_mapping_url: null, created_at: "2026-06-11T00:00:00Z",
  conversion_job_id: null, queue_position: null, updated_at: "2026-06-11T00:00:00Z",
  ifc_ready_job_id: "ifcready_ok", external_model_version_id: "ext_ok",
  status: "dispatched", conversion_status: "dispatched", dispatch_error: null,
};

// waitFor：輪詢直到斷言成立（同 incomingHandoff.test.tsx pattern）。每輪包一次 act flush 一個
// microtask + 觸發重繪；斷言通過即返回，達上限仍不過才拋最後一次 AssertionError。
async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

describe("useConversionData（MD 三頁合一 Task 2 資料層 hook）", () => {
  const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
  let container: HTMLDivElement;
  let root: Root;
  let prevActEnv: unknown;
  // harness 把 hook 每次 render 的回傳值寫進外部變數（沒有 renderHook 的替代掛載法）。
  let latest: ConversionData | null;
  function Harness() {
    latest = useConversionData();
    return null;
  }

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
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
  });

  it("[1] listIfcReady 截斷（count=60 > items 1 筆）→ jobsTruncated=true、jobsLoaded=true", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 60, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [] });

    await act(async () => { root.render(createElement(Harness)); });
    await waitFor(() => {
      expect(latest!.jobsLoaded).toBe(true);
      expect(latest!.jobsTruncated).toBe(true);
    });
    expect(latest!.jobs.length).toBe(1);
  });

  it("[2] getConversionRecords reject → recErr 非 null、recordsIncomplete=true、recordsLoaded=true", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockResolvedValue({ enabled: false });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockRejectedValue(new Error("coordinator /api/conversion/records -> 500"));
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [] });

    await act(async () => { root.render(createElement(Harness)); });
    await waitFor(() => {
      expect(latest!.recordsLoaded).toBe(true);        // settle 過（成功或失敗皆算）
      expect(latest!.recErr).not.toBeNull();           // CV 語意：誠實錯誤訊息
      expect(latest!.recordsIncomplete).toBe(true);    // M 語意：載入失敗 → 併入 incomplete
    });
  });

  it("[3] minioWatchStatus reject 不污染 jobs：jobs 有值、mwErr 非 null、load() 回 { jobsOk:true, mwOk:false }", async () => {
    vi.spyOn(coordinatorClient, "listIfcReady").mockResolvedValue({ count: 1, items: [okJob] });
    vi.spyOn(coordinatorClient, "minioWatchStatus").mockRejectedValue(new Error("coordinator /api/external/minio-watch/status -> 404"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getConversionsHistory").mockResolvedValue({ items: [] });

    await act(async () => { root.render(createElement(Harness)); });
    // mount 的 load() 已 settle：jobs 端成功、watcher 端獨立錯誤，互不污染。
    await waitFor(() => {
      expect(latest!.jobs.length).toBeGreaterThan(0);
      expect(latest!.mwErr).not.toBeNull();
    });
    expect(latest!.jobsErr).toBeNull(); // jobs 端沒有被 watcher 錯誤連坐

    // 顯式呼叫 load() 驗回傳的兩端 settle 旗標（runAction 依此判斷證據型刷新是否真取得新狀態）。
    let res: { jobsOk: boolean; mwOk: boolean } | undefined;
    await act(async () => { res = await latest!.load(); });
    expect(res).toEqual({ jobsOk: true, mwOk: false });
  });
});
