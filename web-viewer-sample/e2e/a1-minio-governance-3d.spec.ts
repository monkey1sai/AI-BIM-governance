import { test, expect } from "@playwright/test";

// A1 重構（B2）MinIO 排隊垂直切片：選 MinIO source_ifc 模型 → 排入 IFC→USD 轉檔 → 真 ifc_ready job id
// → 誠實 lifecycle 狀態行（detected/queued/converting；轉檔未完成不顯示假 ready）→ #conv 連結。
// 前置：cd web-viewer-sample && npm run build:ui，再重啟 branch coordinator(:8005) 服務新 dist-ui；
// MinIO watch env 須齊（endpoint/bucket/credentials）。未重建 console → 觀察可能是陳舊碼，不算驗證。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

test.describe("A1 MinIO 排隊 → 誠實轉檔狀態（B2）", () => {
  test.setTimeout(120_000);
  let sourceKey = "";

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try { apiOk = (await request.get(`${COORDINATOR}/health`, { timeout: 10_000 })).ok(); } catch { apiOk = false; }
    test.skip(!apiOk, "branch coordinator 未備妥：需啟動 :8005 或設定 E2E_COORDINATOR_BASE_URL");

    sourceKey = "";
    try {
      const res = await request.get(`${COORDINATOR}/api/minio/objects`, { timeout: 15_000 });
      const body = await res.json();
      const objs = Array.isArray(body?.objects) ? body.objects as Array<{ key: string; role: string }> : [];
      sourceKey = objs.find((o) => o.role === "source_ifc")?.key ?? "";
    } catch { sourceKey = ""; }
    test.skip(!sourceKey, "MinIO 未設定或無 source_ifc 物件（GET /api/minio/objects 空）：需填 MINIO_WATCH_* 並上傳真 .ifc");

    await page.goto(`${COORDINATOR}/ui/#/a1`, { waitUntil: "domcontentloaded" });
    const hasBranchUi = await page.getByTestId("a1-minio-select").waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    test.skip(!hasBranchUi, "coordinator dist-ui 非本 branch：需 npm run build:ui 後重啟 :8005");
  });

  test("選 MinIO 模型 → 排入轉檔 → 真 job id + 誠實 lifecycle 狀態行 + #conv 連結", async ({ page }) => {
    await page.getByTestId("a1-minio-select").selectOption(sourceKey);
    await expect(page.getByTestId("a1-trigger-convert")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-trigger-convert").click();
    // loading→success：真 ifc_ready job id 出現（runtime ID 證據）。
    await expect(page.getByTestId("a1-convert-job")).toContainText("ifcready", { timeout: 30_000 });
    // 誠實 lifecycle：原樣顯示 detected/queued/converting…（轉檔未完成不顯示假 ready）。失敗終態 failed 同屬誠實狀態
    // （顯示 failed 而非偽造 ready），須一併納入接受集合：環境配置不全（MinIO 未設定 / converter 未運行 / IFC 不合法）
    // 時轉檔會立即 failed，若 regex 不含 failed 會被當成 30s timeout，誤報為測試設計問題而掩蓋真正的「轉檔已失敗」。
    const statusLine = page.getByTestId("a1-convert-status");
    await expect(statusLine).toContainText(/detected|queued|converting|downloaded|queued_for_conversion|failed/, { timeout: 30_000 });
    const statusText = (await statusLine.textContent()) ?? "";
    if (/failed/.test(statusText)) {
      // 失敗終態：誠實狀態行顯示 failed（非偽造 ready）。明確標註並斷言此誠實失敗路徑，讓 CI/操作員一眼分辨
      // 「環境/轉檔失敗」而非「測試逾時」。註：lifecycle=failed 走成功輪詢、convErr 為 null，a1-convert-error 僅在
      // 輪詢 throw 例外時出現，故此處不誤斷其可見（否則會與乾淨 failed 狀態相矛盾、把環境問題反報成 UI 缺陷）。
      test.info().annotations.push({ type: "conversion-failed", description: statusText.trim() });
      expect(statusText).toContain("failed");
    } else {
      // 進行中（intermediate）：誠實顯示中間態，且轉檔未完成絕不顯示假 ready。
      expect(statusText).not.toContain("ready");
    }
    await expect(page.getByTestId("a1-conv-link")).toBeVisible();
    await page.screenshot({ path: "../docs/evidence/a1-minio-governance-3d/queue-status.png", fullPage: true });
  });

  // ready 之後續段（auto-session → for-session 檢核 → 3D 高亮）依賴真 converter 回填 conversion_status=ready。
  // dev stack 該 callback 未驗時 lifecycle 停在 converting；不偽造，明標 NOT BUILT。3D 高亮證據改由
  // viewer-embed-a1-highlight.spec.ts（既有 :49101 conversion 建好的 session）獨立取得。
  test.fixme("轉好 → auto-session → for-session 檢核 → 3D 高亮（NOT BUILT: 真 converter ready callback 未驗）", async () => {
    // 待補：真 stack converter 回填 ready 後，驗 a1-convert-status 顯 ready → A1 撈到 auto-session →
    //       a1-step-run(for-session) → a1-rulerun-scoreboard → a1-highlight-3d → a1-highlight-status「已在 3D 標示」+ 截圖。
  });
});
