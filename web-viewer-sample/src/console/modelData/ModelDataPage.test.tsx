// web-viewer-sample/src/console/modelData/ModelDataPage.test.tsx
// MD 三頁合一 Task 6：殼層 ModelDataPage（組雙欄、選檔 state、handoff 統一接收與導覽、頁尾折疊 Panel）。
// 測試模式：殼層自己呼 useConversionData()/useMinioFolder()（無 props），故 vi.mock 這兩個 hook 模組回
// 固定資料（vi.hoisted holder 讓每個 test 可換值）。真 useIncomingHandoff（讀 window.location.hash）與真
// 子元件（MinioTreePane/GlobalConversionPane/ObjectDetailPane）一同掛載——驗殼層真行為（非構造死畫面）。
// 斷言一律 waitFor 輪詢（禁同步斷言，flaky 前科：minio-watcher-loop / vimock-forwardref）。
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversionData } from "./useConversionData";
import type { MinioFolderState } from "./useMinioFolder";
import type { ConversionRecord, IfcReadyListItem, MinioFolderListing, MinioObject } from "../coordinatorClient";

// vi.hoisted holder：mock 工廠讀它，test 可在 render 前換值（hook 是 module 級，改 holder 後須 re-render）。
const H = vi.hoisted(() => ({ conv: null as unknown, folder: null as unknown }));
vi.mock("./useConversionData", () => ({ useConversionData: () => H.conv }));
vi.mock("./useMinioFolder", () => ({ useMinioFolder: () => H.folder }));

// 動態 import：確保 ModelDataPage 在 vi.mock 就緒後才載入（拿到被 mock 的 hook）。
import { ModelDataPage } from "./ModelDataPage";

const actEnvKey = "IS_REACT_ACT_ENVIRONMENT" as const;

async function waitFor(assert: () => void, maxTicks = 40): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < maxTicks; i++) {
    await act(async () => { await Promise.resolve(); });
    try { assert(); return; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

const K = "mw_key0000000001";

function makeObject(over: Partial<MinioObject> = {}): MinioObject {
  return {
    key: "a/b/model.ifc", etag: "etag1", role: "source_ifc",
    project_id: "p1", project_display_name: "專案A", category: "建築",
    version: "v1", idempotency_key: K,
    ...over,
  };
}

function makeRecord(over: Partial<ConversionRecord> = {}): ConversionRecord {
  return {
    idempotency_key: K, project_id: "p1", project_display_name: "專案A",
    category: "建築", external_model_version_id: "000001", conversion_job_id: null,
    status: "failed", usdc_key: null, coverage_report: null,
    object_key: "a/b/model.ifc", detected_at: "2026-06-23T02:00:00.000Z",
    updated_at: "2026-06-23T02:05:00.000Z",
    ...over,
  };
}

function makeJob(over: Partial<IfcReadyListItem> = {}): IfcReadyListItem {
  return {
    ifc_ready_job_id: "ifcready_1", status: "dispatch_failed", project_id: "p1",
    external_model_version_id: "000001", download_status: "downloaded",
    conversion_status: "dispatch_failed", conversion_authority: null,
    queue_position: null, conversion_job_id: null, dispatch_error: null,
    review_session_id: null, viewer_url: null, expected_stage_url: null,
    expected_mapping_url: null, created_at: "2026-06-16T00:00:00Z",
    updated_at: "2026-06-16T00:00:00Z", idempotency_key: K,
    ...over,
  };
}

function makeData(over: Partial<ConversionData> = {}): ConversionData {
  return {
    jobs: [], jobsErr: null, jobsTruncated: false, jobsLoaded: true,
    records: [], recErr: null, recordsTruncated: false, recordsLoaded: true,
    recordsIncomplete: false, mw: null, mwErr: null, history: null, historyErr: false,
    busy: false,
    load: vi.fn(async () => ({ jobsOk: true, mwOk: true })),
    loadRecords: vi.fn(async () => {}),
    ...over,
  };
}

function makeFolder(over: Partial<MinioFolderListing> | null = {}): MinioFolderListing | null {
  if (over === null) return null;
  return {
    bucket: "bim-control", prefix: "a/b/", folders: [], objects: [], count: 0,
    ...over,
  };
}

function makeFs(over: Partial<MinioFolderState> = {}): MinioFolderState {
  return {
    folder: makeFolder({ objects: [makeObject()] }), prefix: "a/b/", loading: false, err: null,
    stalePrefixes: new Set<string>(),
    navigate: vi.fn(), refreshCurrent: vi.fn(),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let prevActEnv: unknown;

beforeEach(() => {
  prevActEnv = (globalThis as Record<string, unknown>)[actEnvKey];
  (globalThis as Record<string, unknown>)[actEnvKey] = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  window.location.hash = "";
  H.conv = makeData();
  H.folder = makeFs();
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  document.body.removeChild(container);
  vi.restoreAllMocks();
  window.location.hash = "";
  (globalThis as Record<string, unknown>)[actEnvKey] = prevActEnv;
});

function render() {
  root = createRoot(container);
  act(() => { root.render(createElement(ModelDataPage)); });
}

function bannerStatus(): string | null {
  return container.querySelector('[data-testid="md-incoming-handoff"]')?.getAttribute("data-handoff-status") ?? null;
}

// 1) job_id 分支（向 jobs 重驗，CV 語意）：未 settle → indeterminate；命中 → verified；settle 未命中且未截斷 → not_found。
describe("ModelDataPage：handoff job_id 分支（向 jobs 重驗）", () => {
  it("[1a] jobsLoaded=false → banner indeterminate", async () => {
    window.location.hash = "#minio?source=intake&job_id=J";
    H.conv = makeData({ jobs: [], jobsLoaded: false });
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("indeterminate"); });
  });

  it("[1b] jobs 命中 J → verified", async () => {
    window.location.hash = "#minio?source=intake&job_id=J";
    H.conv = makeData({ jobs: [makeJob({ ifc_ready_job_id: "J" })], jobsLoaded: true });
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("verified"); });
  });

  it("[1c] jobsLoaded=true 未命中且 jobsTruncated=false → not_found", async () => {
    window.location.hash = "#minio?source=intake&job_id=J";
    H.conv = makeData({ jobs: [makeJob({ ifc_ready_job_id: "other" })], jobsLoaded: true, jobsTruncated: false });
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("not_found"); });
  });

  it("[1d] job_id 命中不自動選檔（維持 GlobalConversionPane，佇列高亮已足）", async () => {
    window.location.hash = "#minio?source=intake&job_id=J";
    H.conv = makeData({ jobs: [makeJob({ ifc_ready_job_id: "J" })], jobsLoaded: true });
    render();
    await waitFor(() => {
      // 全域視圖仍在（未被挾持切成單檔詳情）
      expect(container.querySelector('[data-testid="md-conversion-stats"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="md-detail-back"]')).toBeNull();
    });
    // 導覽 effect 未觸發（無 minio_key/prefix）
    expect((H.folder as MinioFolderState).navigate).not.toHaveBeenCalled();
  });
});

// 2) minio_key 分支（向 folder.objects 重驗，M 語意）：folder=null → indeterminate；命中 → verified 且 navigate 呼一次。
describe("ModelDataPage：handoff minio_key 分支（向 folder.objects 重驗＋導覽 effect）", () => {
  it("[2a] folder=null → indeterminate", async () => {
    window.location.hash = "#minio?source=conv&minio_key=a/b/model.ifc";
    H.folder = makeFs({ folder: null });
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("indeterminate"); });
  });

  it("[2b] folder.objects 命中 → verified，且 navigate 呼叫過一次（prefix=a/b/）", async () => {
    window.location.hash = "#minio?source=conv&minio_key=a/b/model.ifc";
    const navigate = vi.fn();
    H.folder = makeFs({ folder: makeFolder({ prefix: "a/b/", objects: [makeObject({ key: "a/b/model.ifc" })] }), navigate });
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("verified"); });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("a/b/");
  });
});

// 3) 無 id 欄位 → not_applicable（中性，非警示）。
describe("ModelDataPage：handoff 無欄位分支", () => {
  it("[3] #minio?source=a1（無 id 欄位）→ not_applicable", async () => {
    window.location.hash = "#minio?source=a1";
    render();
    await waitFor(() => { expect(bannerStatus()).toBe("not_applicable"); });
  });
});

// 4) 選檔切換：點左欄物件 → ObjectDetailPane；點返回 → GlobalConversionPane。
describe("ModelDataPage：主從切換（選檔 → 詳情 → 返回）", () => {
  it("[4] 點左欄 source_ifc 物件 → 詳情出現；點返回 → 全域視圖回來", async () => {
    H.folder = makeFs({ folder: makeFolder({ prefix: "a/b/", objects: [makeObject({ key: "a/b/model.ifc", idempotency_key: K })] }) });
    H.conv = makeData({ records: [makeRecord()] });
    render();
    // 初始為全域視圖
    await waitFor(() => { expect(container.querySelector('[data-testid="md-conversion-stats"]')).not.toBeNull(); });
    // 點左欄可選檔鈕
    let selBtn: HTMLButtonElement | null = null;
    await waitFor(() => { selBtn = container.querySelector(`[data-testid="md-tree-select-${K}"]`); expect(selBtn).toBeTruthy(); });
    await act(async () => { selBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    // 詳情出現、全域視圖消失
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-back"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="md-detail-key"]')!.textContent).toContain("a/b/model.ifc");
      expect(container.querySelector('[data-testid="md-conversion-stats"]')).toBeNull();
    });
    // 點返回 → 全域視圖回來
    const backBtn = container.querySelector('[data-testid="md-detail-back"]') as HTMLButtonElement;
    await act(async () => { backBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-conversion-stats"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="md-detail-back"]')).toBeNull();
    });
  });

  // selectedKey 在 folder 重載後查無物件（物件被刪）→ selectedObj 為 null 自動回總覽（brief 明定，誠實不顯 stale 詳情）。
  it("[4b] folder 重載後查無選中物件 → 自動回總覽（不顯 stale 詳情）", async () => {
    H.folder = makeFs({ folder: makeFolder({ prefix: "a/b/", objects: [makeObject({ key: "a/b/model.ifc", idempotency_key: K })] }) });
    render();
    let selBtn: HTMLButtonElement | null = null;
    await waitFor(() => { selBtn = container.querySelector(`[data-testid="md-tree-select-${K}"]`); expect(selBtn).toBeTruthy(); });
    await act(async () => { selBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => { expect(container.querySelector('[data-testid="md-detail-back"]')).not.toBeNull(); });
    // 模擬 folder 重載後該物件已被刪：換 mock folder 為空 objects，re-render（selectedKey state 保留）。
    H.folder = makeFs({ folder: makeFolder({ prefix: "a/b/", objects: [] }) });
    await act(async () => { root.render(createElement(ModelDataPage)); });
    await waitFor(() => {
      expect(container.querySelector('[data-testid="md-detail-back"]')).toBeNull();       // 詳情消失
      expect(container.querySelector('[data-testid="md-conversion-stats"]')).not.toBeNull(); // 自動回總覽
    });
  });
});

// 頁尾兩個折疊/說明 Panel（DEMO bucket layout ＋ 與功能頁的關係，spec §4 #6/#7）。
describe("ModelDataPage：頁尾說明 Panel", () => {
  it("[5] DEMO bucket layout（含 [DEMO] 標示）＋『與功能頁的關係』兩 Panel 皆在", async () => {
    render();
    await waitFor(() => {
      expect(container.textContent).toContain("Bucket layout");
      expect(container.textContent).toContain("[DEMO]");
      expect(container.textContent).toContain("與功能頁的關係");
    });
  });
});
