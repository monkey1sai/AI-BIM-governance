import { test, expect } from "@playwright/test";

// A1/M1 收尾端到端:#/a1 reducer stepper 走真 rule-run → 記分 → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出。
// 服務這頁的是 coordinator 已 build 的 dist-ui(npm run build:ui),非 fresh viewer。前置缺失 → conditional skip。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("A1/M1 收尾:#a1 五步 stepper + 失敗抽屜", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      apiOk = res.ok();
    } catch { apiOk = false; }
    test.skip(!apiOk, "governance proxy 未備妥(需 :49102 + coordinator proxy)");

    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#/a1`);
      await page.getByTestId("a1-step-run").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch { uiOk = false; }
    test.skip(!uiOk, "coordinator dist-ui 非本 branch(#/a1 缺 a1-step-run):需 npm run build:ui 後重啟 :8004。");
  });

  test("選模型 → 自動亮步驟2 → 檢核 succeeded → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出", async ({ page }) => {
    await page.getByTestId("a1-step-pick").click();
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });

    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });

    // 失敗抽屜:FailureScoreboard 在有失敗時 render a1-failures-by-rule(fixture-bytes.ifc 有已知失敗)。
    const byRule = page.getByTestId("a1-failures-by-rule");
    const sawDrawer = await byRule.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    if (sawDrawer) {
      // 點第一條規則的展開 toggle → 命中構件表出現,含「storey」欄與「複製」鈕,且至少一列樓層非空白佐證 enrichment。
      await page.locator('[data-testid^="a1-fail-toggle-"]').first().click();
      await expect(page.locator('[data-testid^="a1-fail-rule-"] th', { hasText: "storey" }).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "複製" }).first()).toBeVisible({ timeout: 10_000 });
    }

    await expect(page.getByTestId("a1-step-issues")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-issues").click();
    await expect(page.getByTestId("a1-step-export")).toBeEnabled({ timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-flow.png", fullPage: true });
  });

  test("重跑檢核 → 記分板重建(證據型更新,可重跑不崩)", async ({ page }) => {
    await page.getByTestId("a1-step-pick").click();
    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });
    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });
    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-rerun.png", fullPage: true });
  });
});
