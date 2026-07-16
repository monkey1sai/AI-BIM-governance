import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

// IA v2（UnifiedConsole）：#runtime 改掛新殼 Ops 頁（Runtime / Kit · GPU 營運）；
// 舊 Coordinator runtime console（h1 Coordinator Console、四 tab、ATC read-only、StreamConfigReader）
// 遷至 legacy 路由 #coordinator（EdgeConsole.tsx renderBody case "coordinator" → CoordinatorPage）。
// nav / FlowBar 只存在 legacy 殼 → 相關斷言一律在 legacy 路由（#/sessions、#/coordinator）上驗。
test.describe("co-console-runtime-merge", () => {
  test("legacy nav has no CO entry, FlowBar routes to #runtime (unified Ops)", async ({ page }) => {
    // legacy 殼（#/sessions）驗 nav：無「審查控制台」項；MD 合一後轉檔/資料入口＝「模型資料與轉檔」
    //（原「IFC→USD 轉檔排程」「MinIO 資料」兩項已合併，data.ts PAGES 無 conv/intake 鍵）。
    await page.goto(`${COORDINATOR}/ui#/sessions`);
    await expect(page.getByText("落地端控制台", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /審查控制台/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /模型資料與轉檔/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Runtime 觀測值班台/ })).toBeVisible();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-nav-no-co.png", fullPage: true });

    // FlowBar ③ 建立審查會議 → #runtime；落點＝UnifiedConsole Ops（非舊 Coordinator console）。
    await page.getByRole("button", { name: /建立審查會議/ }).first().click();
    await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
    await expect(page.getByText("Runtime / Kit · GPU 營運")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Coordinator Console/ })).toHaveCount(0);

    // FlowBar ⑤ 紀錄回寫雲端 → 同樣導 #runtime（FlowBar 僅存在 legacy 殼，需先回 legacy 路由）。
    await page.goto(`${COORDINATOR}/ui#/sessions`);
    await page.getByRole("button", { name: /紀錄回寫雲端/ }).first().click();
    await expect(page).toHaveURL(/#\/?runtime$/, { timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/co-merge-flow-runtime.png", fullPage: true });
  });

  test("#coordinator owns the Coordinator console: duty nav label, four tabs, read-only ATC actions", async ({ page }) => {
    // CoordinatorPage 掛載即打 GET /api/runtime/status（pages.tsx CoordinatorPage.load）。
    const runtimeStatusRequest = page.waitForRequest(
      (request) => request.url().includes("/api/runtime/status"),
      { timeout: 20_000 },
    );

    await page.goto(`${COORDINATOR}/ui#/coordinator`);
    await runtimeStatusRequest;

    await expect(page.getByRole("heading", { name: /Coordinator Console/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Runtime 觀測值班台/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /串流執行狀態/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /A Classic Dashboard/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /B ATC Tower/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /C Lifecycle Flow/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /D Terminal \/ Debug/ })).toBeVisible();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-four-tabs.png", fullPage: true });

    await page.getByRole("tab", { name: /B ATC Tower/ }).click();
    await expect(page.getByText("Controlled Actions", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    const openPrimary = page.getByRole("button", { name: /Open primary URL/ });
    await expect(openPrimary).toBeVisible();
    await expect(openPrimary).toBeDisabled();
    await page.screenshot({ path: "../artifacts/e2e/co-merge-runtime-readonly.png", fullPage: true });
  });

  test("Terminal/Debug keeps StreamConfigReader reachable and validates session ids", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#/coordinator`);
    await page.getByRole("tab", { name: /D Terminal \/ Debug/ }).click();

    const input = page.getByPlaceholder("review_session_id");
    const readButton = page.getByRole("button", { name: /讀取 stream-config/ });
    await expect(input).toBeVisible({ timeout: 15_000 });
    await expect(readButton).toBeVisible();

    await input.fill("abc");
    await expect(readButton).toBeDisabled();
    await expect(page.getByText(/session id 不符格式/)).toBeVisible();

    const streamConfigRequest = page.waitForRequest(
      (request) => request.url().includes("/api/review-sessions/review_session_x/stream-config"),
      { timeout: 20_000 },
    );
    await input.fill("review_session_x");
    await expect(readButton).toBeEnabled();
    await readButton.click();
    await streamConfigRequest;
    await page.screenshot({ path: "../artifacts/e2e/co-merge-streamconfig-reachable.png", fullPage: true });
  });
});
