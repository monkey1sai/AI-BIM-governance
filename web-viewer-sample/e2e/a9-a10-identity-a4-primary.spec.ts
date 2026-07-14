import { test, expect } from "@playwright/test";

// 本 PR 的 user-facing 驗證（純前端；不需 coordinator / governance）：
//   1. #a9  身分＝機器人／自主巡檢（TARGET-shell §a9；舊 ChatUSD 文案已不定義本 route）
//   2. #a10 身分＝其他應用／AI 決策工作台（TARGET-shell §a10）；ChatUSD 全域右欄改掛 A10
//   3. #apps 的 A1 卡片導向 #a1 五步治理工作台（原誤導向 #issues 規則中心）
//   4. #a4  來源／解譯模式按鈕選中時套 Btn primary（原 className="ec-btn-primary" 會被 Btn
//           丟棄，且該 class 在 edge-console.css 中不存在 → 選中狀態完全不可見）
//
// 服務者＝playwright.config.ts 的 webServer（vite dev :5180），本 branch 的碼。
// a9/a10 在 TRUTH 為 NOT-BUILT 佔位頁，依 PROCESS §3 斷言其對 /api/* 零呼叫。

const SHOT = "../artifacts/e2e/a9-a10-identity-a4-primary";

test.describe("A9/A10 route 身分、A1 卡片導向、A4 選中高亮", () => {
  test("#a9 顯示機器人／自主巡檢；ChatUSD 欄改掛 A10；佔位頁零 /api 呼叫", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) apiCalls.push(r.url());
    });

    await page.goto("/#a9");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("A9 · 機器人 / 自主巡檢");
    // ChatUSD 是全站右欄元件，route 身分交給機器人後改掛 A10。
    await expect(page.getByText("ROADMAP · A10")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/a9-robot-inspection.png`, fullPage: true });

    // PROCESS §3 的「佔位頁對 /api/* 零呼叫」指的是「頁面不得打自己的資料 API 假裝有資料」。
    // 殼層的 SharedStatusProvider（SharedStatusProvider.tsx:34）在**每一頁**都會輪詢
    // /api/runtime/status 餵頂部 HealthChips 健康燈，屬全站殼層行為、非頁面資料呼叫；
    // 若照字面把它算進來，任何 route（含 #home/#a1）都無法滿足此斷言。故排除後再斷言。
    const SHELL_HEALTH_POLL = "/api/runtime/status";
    const pageApiCalls = apiCalls.filter((u) => !u.includes(SHELL_HEALTH_POLL));
    expect(pageApiCalls, "NOT-BUILT 佔位頁不得呼叫頁面資料 API（PROCESS §3 network 面斷言）").toEqual([]);
  });

  test("#a10 顯示其他應用／AI 決策工作台", async ({ page }) => {
    await page.goto("/#a10");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("A10 · 其他應用 / AI 決策工作台");
    await page.screenshot({ path: `${SHOT}/a10-ai-decision.png`, fullPage: true });
  });

  test("#apps 的 A1 卡片導向 #a1（不再導向 #issues）", async ({ page }) => {
    await page.goto("/#apps");
    await page.screenshot({ path: `${SHOT}/apps-cards.png`, fullPage: true });

    await page.locator(".ec-appcard").filter({ hasText: "BIM 治理與模型檢核" }).first().click();

    await expect(page).toHaveURL(/#a1$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("A1");
    await page.screenshot({ path: `${SHOT}/a1-workbench-after-card-click.png`, fullPage: true });
  });

  test("#a4 解譯模式按鈕選中時套用 primary 高亮（修復前完全不可見）", async ({ page }) => {
    await page.goto("/#a4");

    const semantic = page.getByTestId("a4-mode-semantic");
    const deterministic = page.getByTestId("a4-mode-deterministic");

    await semantic.click();
    await expect(semantic).toHaveClass(/\bprimary\b/);
    await expect(deterministic).not.toHaveClass(/\bprimary\b/);
    await page.screenshot({ path: `${SHOT}/a4-mode-semantic-primary.png`, fullPage: true });

    await deterministic.click();
    await expect(deterministic).toHaveClass(/\bprimary\b/);
    await expect(semantic).not.toHaveClass(/\bprimary\b/);
    await page.screenshot({ path: `${SHOT}/a4-mode-deterministic-primary.png`, fullPage: true });

    // 回歸防線：click 後滑鼠仍停在按鈕上（hover 態）。`.ec-btn:hover:not(:disabled)` 的特異性
    // (0,3,0) 高於 `.ec-btn.primary` (0,2,0)，會把 color 覆蓋成 --ec-grn——正是 primary 自身的
    // 背景色——使 hover 中的 primary 按鈕文字完全蒸發（A1「執行檢核」等主要 CTA 皆中）。
    // toHaveClass 與 unit test 都抓不到這種失效，只有 browser 的 computed style／截圖看得見。
    const hovered = await deterministic.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(
      hovered.color,
      `primary 按鈕 hover 時文字色不得與背景同色（color=${hovered.color} / bg=${hovered.background}）`,
    ).not.toBe(hovered.background);
    await page.screenshot({ path: `${SHOT}/a4-mode-primary-hover-readable.png`, fullPage: true });
  });
});
