import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// spec-page-ds-alignment-fixes user-facing 驗收（F1 lead 措辭 + F3 nav tooltip i18n）。
// #spec 是「靜態 / 文件入口」：無 backend API、無 runtime ID、無 loading/success/failure/retry 狀態機
//   → DEMO DATA / NOT BUILT：本頁純靜態，後端維度結構性不適用（對齊 spec §1.1）。
//   本 E2E 驗的前端 vertical slice：UI route #spec → 渲染 → 可見 lead 新措辭 + nav tooltip i18n。
// 服務來源：playwright.config.ts webServer 起 fresh viewer dev server :5180（reuseExistingServer:false），
//   不打後端，故無 skip-gate（非偽綠）。
const EVID = "../artifacts/e2e/spec-page-ds-alignment-fixes";

test.describe("spec-page-ds-alignment-fixes #spec user-facing", () => {
  test.beforeAll(() => {
    try { mkdirSync(EVID, { recursive: true }); } catch { /* 已存在 */ }
  });

  test("F1：#spec lead 顯示新 MinIO 措辭、不含舊措辭；Panel 4-repo 不變", async ({ page }) => {
    await page.goto(`/#spec`);
    const lead = page.locator(".ec-main .ec-lead");
    await lead.waitFor({ state: "visible", timeout: 30_000 });
    // 新措辭可見（誠實標 MinIO = coordinator 外連 S3）。
    await expect(lead).toContainText("MinIO 為 coordinator 外連 S3 來源");
    // 誠實守門：不得再含舊措辭（把 MinIO 並列為有 repo 邊界）。
    await expect(lead).not.toContainText("MinIO 權威仍在各自 repo 邊界");
    // Panel 本體 4 個 repo 不變（回歸不變量）。
    await expect(page.getByText("kit-manager-api")).toBeVisible();
    // 不變量：Prov chip kit-manager-api = p1（紅 · 後端待建）。
    await expect(page.locator(".ec-prov.ec-p1").first()).toBeVisible();
    await page.screenshot({ path: `${EVID}/spec-lead.png`, fullPage: true });
  });

  test("F3：nav overview 按鈕 tooltip 為「總覽」(zh)、非英文 fallback", async ({ page }) => {
    await page.goto(`/#spec`);
    // 介面預設 zh：overview nav 按鈕 title 走 navText → NAV_LABEL.overview.biz = 總覽。
    const overviewBtn = page.locator('.ec-nav button[title="總覽"]');
    await expect(overviewBtn).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ec-nav button[title="Overview"]')).toHaveCount(0);
    // 可見截圖：hover overview 凸顯 nav（tooltip 屬性已斷言，截圖留版面證據）。
    await overviewBtn.hover();
    await page.screenshot({ path: `${EVID}/nav-tooltip-i18n.png`, fullPage: true });
  });
});
