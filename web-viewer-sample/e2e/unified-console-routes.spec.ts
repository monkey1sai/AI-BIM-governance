import { test, expect } from "@playwright/test";

// IA v2（UnifiedConsole）：coordinator :8004/ui 的 approved 鍵 {home,a1..a10,pipeline,runtime}
// 改掛 UnifiedShell 新殼（EdgeConsole.tsx renderUnified），其餘 legacy 鍵保留舊殼。
// 本 spec 專注「/ui 預設頁＝UnifiedConsole home ＋ 換台後仍保留的 operator-tool 路由
// （#/kit、#/demo-control、#/review）＋ #/runtime＝新 Ops 頁 ＋ 新殼側欄導覽」。
// 舊 Coordinator runtime console（四 tab / ATC / StreamConfigReader）遷至 #coordinator，
// 由 co-console-runtime-merge.spec.ts 覆蓋。/ui/console 301、/ui/open 302 凍結由 ui-open-regression.spec 覆蓋。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("B 操作台：:8004/ui UnifiedConsole 路由 + 保留 operator-tool 路由", () => {
  test("/ui 掛 UnifiedConsole home；保留 #/kit、#/demo-control、#/review 可達；#/runtime＝新 Ops", async ({ page }) => {
    // /ui 無 hash → UnifiedConsole home（總覽 · Mission Control，fixtures.ts getL().home_title）。
    await page.goto(`${COORDINATOR}/ui`);
    await expect(page.getByText("總覽 · Mission Control")).toBeVisible({ timeout: 20_000 });

    // #/kit → Kit 模型台（/api/kit proxy 面板）——換殼後仍保留（非 silently 砍）。
    await page.goto(`${COORDINATOR}/ui#/kit`);
    await expect(page.getByTestId("kit-proxy-panel")).toBeVisible({ timeout: 15_000 });

    // #/demo-control → 真實 IFC 進件垂直切片——保留（真實 IFC E2E 入口）。
    await page.goto(`${COORDINATOR}/ui#/demo-control`);
    await expect(page.getByTestId("real-ifc-demo-control")).toBeVisible({ timeout: 15_000 });

    // #/review → Review Room（審查室，legacy 殼保留）。
    await page.goto(`${COORDINATOR}/ui#/review`);
    await expect(page.getByRole("heading", { name: /審查室/ })).toBeVisible({ timeout: 15_000 });

    // #/runtime → UnifiedConsole Ops 頁（Runtime / Kit · GPU 營運，fixtures.ts getL().ops_title）。
    // 舊 Coordinator runtime console 已遷 #coordinator：此 route 不得再出現 Coordinator Console。
    await page.goto(`${COORDINATOR}/ui#/runtime`);
    await expect(page.getByText("Runtime / Kit · GPU 營運")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("服務健康")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("GPU Fleet")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Coordinator Console/ })).toHaveCount(0);

    await page.screenshot({ path: "../artifacts/e2e/unified-console-routes.png", fullPage: true });
  });

  test("UnifiedConsole 側欄點擊切換 A1→A2（hash 更新 + dock tab 高亮，零依賴 hash 路由）", async ({ page }) => {
    // #/a1 → UnifiedShell workspace（dock=a1）：dock tab「A1 治理檢核」＋ A1 dock（規則集 / 重新執行）。
    await page.goto(`${COORDINATOR}/ui#/a1`);
    await expect(page.getByText("規則集", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("重新執行", { exact: true })).toBeVisible();

    // 點側欄「AI 應用模組」的 A2 項（fixtures.ts apps[1]：labelZh=版本 Diff → nav("#a2")）。
    await page.getByText("版本 Diff", { exact: true }).click();
    await expect(page).toHaveURL(/#\/?a2$/);
    // dock tab 高亮：active tab（A2 Diff）fontWeight 700，非 active（A1 治理檢核）400
    //（WorkspacePage.tsx dockTabs 渲染：fontWeight ws.dock===d.id ? 700 : 400）。
    await expect(page.getByText("A2 Diff", { exact: true })).toHaveCSS("font-weight", "700");
    await expect(page.getByText("A1 治理檢核", { exact: true })).toHaveCSS("font-weight", "400");
    // dock 面板本體切到 A2（docks.tsx A2Dock 標題「A2 版本 Diff」）。
    await expect(page.getByText("A2 版本 Diff", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.screenshot({ path: "../artifacts/e2e/unified-console-nav.png", fullPage: true });
  });
});
