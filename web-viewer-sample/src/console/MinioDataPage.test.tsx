// MinioDataPage：逐層資料夾導覽（spec §2.5）+ ledger chip + 一鍵觸發（Task 7）。
// 照 ConversionSchedulingPage.test.tsx 的 createRoot + act 模式。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioDataPage } from "./pages";
import { coordinatorClient, type MinioObject } from "./coordinatorClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;
const ifcObj: MinioObject = {
  key: "東勢區許良宇紀念圖書館/root/main/000001/model.ifc",
  etag: "abc", role: "source_ifc", idempotency_key: "mw_aaaa0000bbbb0001",
  project_id: "mv_1a2b3c4d", project_display_name: "東勢區許良宇紀念圖書館", category: "main", version: "000001",
};

describe("MinioDataPage — 逐層資料夾導覽 + chip + 觸發", () => {
  let container: HTMLDivElement; let prevActEnv: unknown;
  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div"); document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container); vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("[7a] 頂層顯示 folders（資料夾節點），不再用 buildMinioTree 攤平", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [{ prefix: "洲際好宅/", has_source_ifc: false }, { prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true }],
      objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("洲際好宅");
    expect(container.textContent).toContain("東勢區許良宇紀念圖書館");
  });

  it("[7a] 資料夾（遞迴）含 .ifc → 顯『含 source IFC』badge；不含則不顯（spec §2.5 第 5 點，獨立 AC）", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: [{ prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true }, { prefix: "annotations/", has_source_ifc: false }],
      objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    // 含 .ifc 的資料夾旁有 badge；不含的資料夾旁無 badge（用 testid 精準定位避免誤判）。
    expect(container.querySelector('[data-testid="minio-folder-badge-東勢區許良宇紀念圖書館/"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="minio-folder-badge-annotations/"]')).toBeNull();
    expect(container.textContent).toContain("含 source IFC");
  });

  it("[7b][7c] 葉層 .ifc：顯示來源 IFC role + 三段 badge + ledger chip + 觸發鈕", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 1, items: [{ idempotency_key: "mw_aaaa0000bbbb0001", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "000001", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("來源 IFC");
    expect(container.textContent).toContain("main");           // 三段 badge
    expect(container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]')).toBeTruthy(); // chip
    expect(container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]')).toBeTruthy(); // 觸發鈕
  });

  it("[7b][7c] 無 ledger 紀錄的 .ifc → chip 顯『未轉』、觸發鈕在", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/未轉/);
  });

  it("[7a] MinIO 未設定（count=0 + note）→ empty 態 (a)：顯『MinIO 未設定』文案", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: null, prefix: "", folders: [], objects: [], count: 0, note: "MinIO watch 未設定（未取得）",
    } as Awaited<ReturnType<typeof coordinatorClient.getMinioFolder>>);
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/未設定|未取得/);
  });

  it("[7a] 已設定但當前 prefix 空（folders=[] objects=[] 無 note）→ empty 態 (b)：顯『此層無物件』非『未設定』", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "洲際好宅/empty/", folders: [], objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/此層|無物件|空/);
    expect(container.textContent).not.toMatch(/MinIO watch 未設定/);
  });

  it("[7a] getMinioFolder reject → 顯誠實錯誤 + 重試鈕，不假裝有資料", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockRejectedValue(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"));
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("/api/minio/objects");
  });

  it("[7a] 頁首保留『唯讀 intake 來源視圖，非 metadata 權威』誠實字樣", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toMatch(/唯讀.*intake.*來源|唯讀.*來源視圖/);
  });

  it("[7b] 會呼叫 getConversionRecords（chip 需 ledger，§2.5 第 6 點）", async () => {
    const spy = vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({ bucket: "bim-control", prefix: "", folders: [], objects: [], count: 0 });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    expect(spy).toHaveBeenCalled();
  });
});
