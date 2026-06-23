// Task 7：#minio 升級讀真實 GET /api/minio/objects（三層 + 角色，移除寫死 demo）。
// 照 ConversionSchedulingPage.test.tsx 的 createRoot + act 模式。
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MinioDataPage } from "./pages";
import { coordinatorClient, type MinioObject } from "./coordinatorClient";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

// 最小 MinioObject fixture：一個 source_ifc，同版本無 .usdc → pending
const ifcObj: MinioObject = {
  key: "松風庵/root/main/000001/model.ifc",
  etag: "abc",
  role: "source_ifc",
  project_id: "mv_1a2b3c4d",
  project_display_name: "松風庵",
  category: "main",
  version: "000001",
};

describe("MinioDataPage — 讀真實 list proxy（Task 7）", () => {
  let container: HTMLDivElement;
  let prevActEnv: unknown;

  beforeEach(() => {
    prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
    (globalThis as Record<string, unknown>)[actEnvKey] = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
    (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
  });

  it("三層樹 render：松風庵 → main → 000001（project_display_name → category → version）", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [ifcObj],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    // 三層節點全出現
    expect(container.textContent).toContain("松風庵");
    expect(container.textContent).toContain("main");
    expect(container.textContent).toContain("000001");
  });

  it("model.ifc 標「來源 IFC」", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [ifcObj],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("來源 IFC");
  });

  it("同版本無 .usdc → 顯「待產生」（prov p1，不假裝已轉）", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 1,
      objects: [ifcObj], // 只有 .ifc，無 .usdc
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("待產生");
  });

  it("同版本有 .ifc 和 .usdc → .usdc 標「已轉 USDC」，不顯「待產生」", async () => {
    const usdcObj: MinioObject = {
      key: "松風庵/root/main/000001/model.usdc",
      etag: "def",
      role: "parsed_usdc",
      project_id: "mv_1a2b3c4d",
      project_display_name: "松風庵",
      category: "main",
      version: "000001",
    };
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 2,
      objects: [ifcObj, usdcObj],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    // 有 .usdc 時 pending 不出現
    expect(container.textContent).not.toContain("待產生");
    // .usdc 自身有角色標籤
    expect(container.textContent).toContain("已轉 USDC");
  });

  it("未設定 MinIO（count:0 + note）→ 顯「未取得」或「未設定」，不顯假資料", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: null,
      count: 0,
      objects: [],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    // 頁面顯示未取得/未設定；不顯示假 bucket 或假檔案
    expect(container.textContent).toMatch(/未取得|未設定/);
  });

  it("getMinioObjects reject → 顯誠實錯誤，不假裝有資料", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockRejectedValue(
      new Error("coordinator /api/minio/objects -> 502 Bad Gateway"),
    );

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("/api/minio/objects");
  });

  it("頁首保留「唯讀 intake 來源視圖，非 metadata 權威」誠實字樣", async () => {
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 0,
      objects: [],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toMatch(/唯讀.*intake.*來源|intake.*來源.*視圖|唯讀.*來源視圖/);
  });

  it("不呼叫 getConversionRecords（#minio 職責獨立）", async () => {
    const spy = vi.spyOn(coordinatorClient, "getConversionRecords");
    vi.spyOn(coordinatorClient, "getMinioObjects").mockResolvedValue({
      bucket: "bim-control",
      count: 0,
      objects: [],
    });

    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });

    expect(spy).not.toHaveBeenCalled();
  });
});
