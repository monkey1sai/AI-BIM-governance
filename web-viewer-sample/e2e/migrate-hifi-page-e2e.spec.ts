import { expect, test } from "@playwright/test";

// migrate-console-to-hifi-design tasks 2.8 / 3.7：逐頁 browser 確認遷移後頁面仍可操作。
// 純前端 vite（playwright webServer）；不需 coordinator / Kit / GPU。
// 2.8 = Unified Pipeline + Concept；3.7 = legacy admin / gpu / sessions。

const SHOT = "../artifacts/e2e/migrate-hifi-page-e2e";

test.describe("migrate Hi-Fi page E2E (2.8 unified + 3.7 legacy)", () => {
  test("2.8 #pipeline PipelinePage 標題與 outbox 可見", async ({ page }) => {
    await page.goto("/#pipeline");
    await expect(page.getByText("模型資料與轉檔生產線")).toBeVisible();
    await expect(page.getByText("⑤ Callback Outbox")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/pipeline.png`, fullPage: true });
  });

  test("2.8 #a9 ConceptPage 可見且標 Concept Preview", async ({ page }) => {
    await page.goto("/#a9");
    await expect(page.getByText("A9 · 機器人 / 自主巡檢", { exact: true })).toBeVisible();
    await expect(page.getByText("Concept Preview / Roadmap")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/concept-a9.png`, fullPage: true });
  });

  test("2.8 #a10 ConceptPage 可見", async ({ page }) => {
    await page.goto("/#a10");
    await expect(page.getByText("A10 · 其他應用 / AI 決策", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOT}/concept-a10.png`, fullPage: true });
  });

  test("3.7 #admin StubPage 系統管理 + provenance", async ({ page }) => {
    await page.goto("/#admin");
    await expect(page.getByRole("heading", { name: "系統管理" })).toBeVisible();
    await expect(page.getByText("RBAC / members")).toBeVisible();
    await expect(page.locator(".ec-prov.ec-p1").first()).toBeVisible();
    await page.screenshot({ path: `${SHOT}/admin.png`, fullPage: true });
  });

  test("3.7 #gpu Review Room 標題與 GPU 補充面板", async ({ page }) => {
    await page.goto("/#gpu");
    await expect(page.getByRole("heading", { name: /Review Room/ })).toBeVisible();
    await expect(page.getByText("GPU 審查室補充")).toBeVisible();
    await expect(page.getByText("deterministic no-GPU")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/gpu.png`, fullPage: true });
  });

  test("3.7 #sessions Session 管理標題與 reclaim", async ({ page }) => {
    await page.goto("/#sessions");
    await expect(page.getByRole("heading", { name: /Session 管理/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reclaim stale spectator/ })).toBeVisible();
    await page.screenshot({ path: `${SHOT}/sessions.png`, fullPage: true });
  });
});
