import { test, expect } from "@playwright/test";

// A1 v2（IA v2 後路由 #a1-workbench）MinIO 來源垂直切片：A1 不觸發轉檔——a1-trigger-convert 恆 disabled，
// IFC→USD 轉檔改在 #minio 模型資料頁排程。本 spec 驗「選 MinIO source_ifc 模型 → 誠實 resolution lifecycle
// （watcher / downloaded / stale 原樣顯示，不偽造 ready；原 a1-convert-job / a1-convert-status testids 已隨
// A1 v2 移除，現行 lifecycle 呈現 = a1-minio-resolution-note + a1-step-pick 動態 label）→ 導向 #minio 的指引存在」。
// 前置：cd web-viewer-sample && npm run build:ui，再重啟 branch coordinator(:8005) 服務新 dist-ui；
// MinIO watch env 須齊（endpoint/bucket/credentials）。未重建 console → 觀察可能是陳舊碼，不算驗證。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

test.describe("A1 v2 MinIO 來源 → 誠實 resolution lifecycle（A1 不觸發轉檔）", () => {
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

    await page.goto(`${COORDINATOR}/ui/#/a1-workbench`, { waitUntil: "domcontentloaded" });
    // A1 v2 預設 source=local_fs，a1-minio-select 要切換來源後才 render；改用永遠 render 的
    // a1-source-minio 來源切換鈕當「本 branch dist-ui」守門（conditional skip，誠實：skip != PASS）。
    const hasBranchUi = await page.getByTestId("a1-source-minio").waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    test.skip(!hasBranchUi, "coordinator dist-ui 非本 branch（#a1-workbench 缺 a1-source-minio）：需 npm run build:ui 後重啟 :8005");
  });

  test("選 MinIO 模型 → A1 不觸發轉檔（恆 disabled）→ 誠實 resolution lifecycle + #minio 指引", async ({ page }) => {
    await page.getByTestId("a1-source-minio").click();
    const minioSelect = page.getByTestId("a1-minio-select");
    await expect(minioSelect).toBeVisible({ timeout: 15_000 });
    await minioSelect.selectOption(sourceKey);

    // (b) 現行 lifecycle 呈現（原 a1-convert-job / a1-convert-status 斷言的替代）：
    //     a1-minio-resolution-note 誠實顯示 watcher/downloaded/stale 解析狀態——terminal 集合每一項都是
    //     誠實狀態（查無 watcher 紀錄 / 未下載完成 / source IFC stale / 已對到 downloaded job），轉檔未完成
    //     絕不顯示假 ready。先等清單載入脫離「正在載入」，再斷言落在 terminal 集合。
    const resolutionNote = page.getByTestId("a1-minio-resolution-note");
    await expect(resolutionNote).toBeVisible({ timeout: 15_000 });
    await expect(resolutionNote).not.toContainText("正在載入", { timeout: 30_000 });
    await expect(resolutionNote).toContainText(/ifc-ready job 清單不可用|尚未找到 watcher 下載紀錄|尚未下載完成|source IFC artifact stale|已對到 watcher downloaded job/);
    // a1-step-pick 動態 label 同步反映 lifecycle（等待 watcher/downloaded/stale/可選取）——第二個誠實信號。
    await expect(page.getByTestId("a1-step-pick")).toContainText(/等待 watcher\/轉檔排程|等待 downloaded session|source IFC artifact stale|選取已下載模型/);
    // A1 v2 常駐指引：MinIO key 不直接送 rule-runs；轉檔由排程頁觸發 POST /api/conversion/trigger。
    await expect(page.getByTestId("a1-minio-source-note")).toBeVisible();

    // (a) A1 不觸發轉檔：a1-trigger-convert 恆 disabled + a1-conv-link（cross-axis handoff）導向 #minio。
    //     兩者位於 sessions.length===0 的 a1-no-session 區塊；環境已有 active/created session 時該區塊被
    //     session view（a1-session-select）取代——此時斷言 session view 真實存在（現行 UI 兩態之一，非放水）。
    const noSession = page.getByTestId("a1-no-session");
    const sessionSelect = page.getByTestId("a1-session-select");
    await expect(noSession.or(sessionSelect)).toBeVisible({ timeout: 15_000 });
    if (await noSession.isVisible()) {
      const trigger = page.getByTestId("a1-trigger-convert");
      await expect(trigger).toBeVisible();
      await expect(trigger).toBeDisabled(); // A1 v2 不觸發 conversion；恆 disabled，非等待 enable
      await expect(trigger).toContainText("A1 不排入轉檔");
      const convLink = page.getByTestId("a1-conv-link");
      await expect(convLink).toBeVisible();
      const href = (await convLink.getAttribute("href")) ?? "";
      expect(href, "a1-conv-link 應以 cross-axis handoff 導向 #minio 模型資料頁").toMatch(/^#minio\?/);
      expect(href).toContain("source=a1");
    } else {
      test.info().annotations.push({ type: "active-session-present", description: "a1-no-session 區塊被 session view 取代；a1-trigger-convert / a1-conv-link 僅存在於無 session 態" });
      await expect(sessionSelect).toBeVisible();
    }
    await page.screenshot({ path: "../docs/evidence/a1-minio-governance-3d/a1-v2-lifecycle-status.png", fullPage: true });
  });

  // A1-G3 缺口（fixme 保留，skip 易被誤讀為 PASS 等價；fixme 明確標記功能缺口）：
  // 「轉檔 ready → 建立 3D session → for-session 檢核 → inline 3D 高亮」的全自動閉環尚未可在本 spec 環境驗證。
  // A1 v2 不觸發轉檔（排程在 #minio 模型資料頁；watcher/converter 回填 conversion_status=ready 後，A1 才能對
  // downloaded job 以 a1-create-review-session 建立 / 重用 3D session）。dev stack 的 converter ready callback
  // 未驗時 lifecycle 誠實停在中間態，不偽造。inline 3D 高亮證據由 viewer-embed-a1-highlight.spec.ts
  //（以 :49101 succeeded conversion 自建 review session）獨立取得。
  test.fixme("轉檔 ready → 建立 3D session → for-session 檢核 → inline 3D 高亮（A1-G3：真 converter ready callback 未驗）", async () => {
    // 待補：真 stack converter 回填 ready 後——a1-minio-resolution-note 顯示「已對到 watcher downloaded job」
    //       → a1-step-pick 選取 downloaded 模型 → a1-create-review-session 建立 / 重用 session →
    //       a1-session-select 選定 → a1-step-run（for-session）→ a1-rulerun-scoreboard →
    //       a1-inline-manual-start → a1-inline-highlight 高亮 ack + 截圖。
  });
});
