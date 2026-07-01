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

  it("[7a][AC1] folders 依 localeCompare('zh-TW') 排序顯示（逆序輸入 → DOM 按 zh-TW 重排）", async () => {
    // 後端 S3 回 CommonPrefixes 為 UTF-8 byte order（非中文 collation）；前端對中文使用者以
    // localeCompare('zh-TW') 重排（spec §2.1 中文排序 / plan line 56『AC1 補排序斷言』）。
    // 三個資料夾刻意以「非 zh-TW 排序」的順序輸入，斷言 DOM 出現順序＝zh-TW 排序後順序。
    const inputPrefixes = ["洲際好宅/", "東勢區許良宇紀念圖書館/", "annotations/"];
    const expectedOrder = [...inputPrefixes].sort((a, b) => a.localeCompare(b, "zh-TW"));
    // 前提：輸入順序與 zh-TW 排序順序不同（否則此測試證不到排序行為）。
    expect(inputPrefixes).not.toEqual(expectedOrder);
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "",
      folders: inputPrefixes.map((p) => ({ prefix: p, has_source_ifc: false })),
      objects: [], count: 0,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    // 資料夾鈕內容即 f.prefix；以 textContent 中各 prefix 首次出現位置驗證相對順序。
    const text = container.textContent ?? "";
    const positions = expectedOrder.map((p) => text.indexOf(p));
    expect(positions.every((pos) => pos >= 0)).toBe(true);
    // 嚴格遞增 → DOM 順序與 zh-TW 排序一致。
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
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
      count: 1, items: [{ idempotency_key: "mw_aaaa0000bbbb0001", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "000001", conversion_job_id: null, status: "queued", usdc_key: null, coverage_report: null, object_key: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain("來源 IFC");
    // 三段 badge：用 data-testid 精準定位 category badge（AC-badge），避免 'main' 子字串撞 prefix 路徑誤判。
    const catBadge = container.querySelector('[data-testid="minio-badge-category-mw_aaaa0000bbbb0001"]');
    expect(catBadge?.textContent).toBe("main");
    expect(container.querySelector('[data-testid="minio-badge-project-mw_aaaa0000bbbb0001"]')?.textContent).toBe("東勢區許良宇紀念圖書館");
    expect(container.querySelector('[data-testid="minio-badge-version-mw_aaaa0000bbbb0001"]')?.textContent).toBe("000001");
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
    // 觸發鈕在（test 名承諾「觸發鈕在」；未轉/failed 狀態下鈕須存在且可按）。
    const triggerBtn = container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]') as HTMLButtonElement | null;
    expect(triggerBtn).toBeTruthy();
    expect(triggerBtn?.disabled).toBe(false);
  });

  it("[7b][honesty] getConversionRecords 載入失敗 → chip 顯『狀態未明』而非靜默誤顯『未轉』(finding #1)", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    // records 載入失敗（coordinator 離線/502/timeout）：loadRecords catch 不再靜默吞。誠實鐵律：失敗是
    // 「可能有紀錄但看不到」，chip 須退 indeterminate（狀態未明），不可誤顯『未轉』(untracked)。
    vi.spyOn(coordinatorClient, "getConversionRecords").mockRejectedValue(new Error("502 Bad Gateway"));
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    const chip = container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]');
    expect(chip?.textContent).toContain("狀態未明");
    expect(chip?.textContent).not.toContain("未轉"); // 不得把載入失敗誤報成『未轉』
  });

  it("[7c] 觸發鈕 click → IntentDialog → confirm → triggerConversion(key) 被呼叫（方向1）→ dialog 關", async () => {
    // 方向1：改走 main 已合併的 triggerConversion(key)（POST /api/conversion/trigger，無 idempotency_key、
    // 只送 key）；觸發成功後不做樂觀 chip patch，chip 一律由 loadRecords() 重抓 ledger 對齊（已由 [7b] chip
    // 測試覆蓋）。此測試聚焦「按鈕→dialog→confirm→triggerConversion 被呼叫→dialog 關」的 observable 行為。
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const triggerSpy = vi.spyOn(coordinatorClient, "triggerConversion").mockResolvedValue({
      ifc_ready_job_id: "ifcready_mw_aaaa0000bbbb0001",
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    // 1) 點觸發鈕 → IntentDialog 開（intent→confirm，非樂觀直發）。
    const triggerBtn = container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]') as HTMLButtonElement;
    expect(triggerBtn).toBeTruthy();
    await act(async () => { triggerBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.querySelector('[data-testid="intent-dialog"]')).toBeTruthy();
    // 2) 點 confirm → triggerConversion 只帶 key 被呼叫（觀察得到的真實行為，AC-trigger；無第二參數 reason）。
    const confirmBtn = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    expect(triggerSpy).toHaveBeenCalledWith("東勢區許良宇紀念圖書館/root/main/000001/model.ifc");
    // 3) 成功 → dialog 關（chip 由 ledger 對齊，非樂觀 patch；chip 狀態驗證在 [7b] 測試）。
    expect(container.querySelector('[data-testid="intent-dialog"]')).toBeNull();
  });

  // 方向1：舊「樂觀 patch + narrowConversionStatus(trigger 回應) → 不鎖 chipOverride」的邊角案例已整段
  // 移除（triggerConversion 回應無 status/idempotency_key，chip 一律由 ledger 對齊）。改寫成失敗路徑：
  // triggerConversion throw → confirmTrigger catch 設 triggerErr、經 IntentDialog actionErr 顯 inline error，
  // dialog 仍在（失敗不關 dialog）、chip 不變、觸發鈕仍可按。
  it("[7c][失敗] triggerConversion throw → 顯 inline error、dialog 不關、chip 不變、觸發鈕仍可按", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    vi.spyOn(coordinatorClient, "triggerConversion").mockRejectedValue(
      new Error("coordinator /api/conversion/trigger -> 503 conversion authority unreachable"),
    );
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    const triggerBtn = container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]') as HTMLButtonElement;
    await act(async () => { triggerBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const confirmBtn = container.querySelector('[data-testid="intent-confirm"]') as HTMLButtonElement;
    await act(async () => { confirmBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });
    // 1) inline error 顯示（dialog 內 actionErr）。MinioDataPage 用 String(e)，故帶端點/狀態碼。
    const actionErr = container.querySelector('[data-testid="intent-action-error"]');
    expect(actionErr).toBeTruthy();
    expect(actionErr?.textContent).toContain("/api/conversion/trigger");
    // 2) dialog 仍在（失敗不關）。
    expect(container.querySelector('[data-testid="intent-dialog"]')).toBeTruthy();
    // 3) chip 不變（無紀錄＝未轉）、觸發鈕仍可按（可 retry，不必 reload 整頁）。
    const chip = container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]');
    expect(chip?.textContent).toMatch(/未轉/);
    const triggerAfter = container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]') as HTMLButtonElement;
    expect(triggerAfter?.disabled).toBe(false);
  });

  // quality finding Important #1：loadRecords 僅取最新 N 筆；ledger 超出上限時，超窗的舊 .ifc
  // 物件在 records 中查無 idempotency_key → 被靜默當『未轉』（違反 AC-chip『無紀錄才標未轉、不臆測』，
  // 因為實際是「有紀錄但前端看不到」）。修法：records 截斷（count > items.length）且該物件不在窗內時，
  // chip 顯誠實『狀態未明』而非『未轉』，且觸發鈕維持可按（觸發冪等、安全）。
  it("[7b][finding-#1] records 截斷（count>items 且物件不在窗內）→ chip 顯『狀態未明』非『未轉』，觸發鈕可按", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    // ledger 實際有 200 筆（count），但 route slice 後只回 100 筆（items），且此物件的 key 不在回傳窗內。
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 200,
      items: [{ idempotency_key: "mw_some_other_key_99", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "999", conversion_job_id: null, status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    const chip = container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]');
    // 截斷下查無紀錄≠『未轉』：誠實顯『狀態未明』，不臆測（AC-chip）。
    expect(chip?.textContent).toMatch(/狀態未明|未明/);
    expect(chip?.textContent).not.toMatch(/未轉/);
    // 觸發鈕維持可按（觸發冪等；使用者仍可主動觸發/重轉）。
    const triggerBtn = container.querySelector('[data-testid="minio-trigger-mw_aaaa0000bbbb0001"]') as HTMLButtonElement;
    expect(triggerBtn?.disabled).toBe(false);
  });

  // finding #1 對照組：records 未截斷（count===items.length）時，查無紀錄仍誠實標『未轉』（原行為不變）。
  it("[7b][finding-#1] records 未截斷且物件不在窗內 → chip 維持『未轉』（不誤報狀態未明）", async () => {
    vi.spyOn(coordinatorClient, "getMinioFolder").mockResolvedValue({
      bucket: "bim-control", prefix: "東勢區許良宇紀念圖書館/root/main/000001/", folders: [], objects: [ifcObj], count: 1,
    });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({
      count: 1,
      items: [{ idempotency_key: "mw_some_other_key_99", project_id: "p", project_display_name: "x", category: "main", external_model_version_id: "999", conversion_job_id: null, status: "ready", usdc_key: null, coverage_report: null, object_key: null, detected_at: "2026-06-24T00:00:00Z", updated_at: "2026-06-24T00:00:00Z" }],
    });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    const chip = container.querySelector('[data-testid="minio-chip-mw_aaaa0000bbbb0001"]');
    expect(chip?.textContent).toMatch(/未轉/);
    expect(chip?.textContent).not.toMatch(/狀態未明/);
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

  // reviewer Major（自 console.test.tsx 遷入）：error 態須有使用者可觸發的重試（不必整頁 reload）。
  // 第一次 getMinioFolder() 失敗 → 顯誠實 error + 重試鈕；點重試 → 重打 → 成功渲染資料夾（error 態清除）。
  it("[7a] error 態點「重試」→ 重打 getMinioFolder() → 成功渲染資料夾（不必整頁 reload）", async () => {
    const spy = vi
      .spyOn(coordinatorClient, "getMinioFolder")
      .mockRejectedValueOnce(new Error("coordinator /api/minio/objects -> 502 Bad Gateway"))
      .mockResolvedValueOnce({
        bucket: "bim-control", prefix: "",
        folders: [{ prefix: "東勢區許良宇紀念圖書館/", has_source_ifc: true }],
        objects: [], count: 0,
      });
    vi.spyOn(coordinatorClient, "getConversionRecords").mockResolvedValue({ count: 0, items: [] });
    const root = createRoot(container);
    await act(async () => { root.render(<MinioDataPage />); });
    await act(async () => { await Promise.resolve(); });
    // error 態顯示錯誤資訊
    expect(container.textContent).toContain("/api/minio/objects");
    expect(container.textContent).toContain("502 Bad Gateway");

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="minio-tree-retry"]');
    expect(retry).not.toBeNull();
    await act(async () => { retry!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("東勢區許良宇紀念圖書館"); // 重試成功 → 真資料夾渲染
    expect(container.textContent).not.toContain("502 Bad Gateway"); // error 態已清除
    expect(spy).toHaveBeenCalledTimes(2); // 真的重打了一次
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
