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

    expect(apiCalls, "NOT-BUILT 佔位頁不得呼叫 /api/*（PROCESS §3 network 面斷言）").toEqual([]);
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
  });
});
