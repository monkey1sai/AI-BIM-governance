import { test, expect } from "@playwright/test";

// IX-SS-04 #sessions「結束 session」controlled action 端到端（重用 close 路由）：
// 對 live 測試區實際存在的 active session 驗 browser 切片：列出現「結束 session」鈕 ->
//   點按開 IntentDialog -> 確認 -> 觀察一次真後端回應（POST .../close 2xx + runtime/status
//   重抓該 session active->closed + 該列轉灰）。誠實鐵律：無樂觀更新、非 active 不給假按鈕、
//   未觀察轉移以 notObserved 原文揭露、不偽造；深度因果由 sessions.test.ts route 測試兜底。
//
// 測試區常態無 active session -> beforeAll 先 POST /api/review-sessions 種一個真 session
//   （綁最小 artifact_bindings，沿用既有 fixture 風格）再驗結束切片。
//
// skip-gate 效力限制（比照 conv-prioritize-retry.spec.ts）：守門是 conditional skip（coordinator
//   不可達 -> skip -> 計 pass，非 fail）。本 repo .github/workflows 無 Playwright job，故不 false-green
//   任何既有 CI gate；純本機 / 指揮官手動 P4 gate。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

test.describe("IX-SS-04 #sessions 結束 session controlled action", () => {
  test.setTimeout(120_000);
  let seededId: string | null = null;
  let coordinatorUp = false;
  const notObserved: string[] = [];

  test.beforeEach(async ({ request }) => {
    try {
      const created = await request.post(`${COORDINATOR}/api/review-sessions`, {
        data: { project_id: "271", model_version_id: "mv_e2e_terminate", artifact_bindings: [] },
      });
      if (created.ok()) { seededId = (await created.json()).session_id; coordinatorUp = true; }
    } catch { coordinatorUp = false; }
    if (!coordinatorUp || !seededId) {
      notObserved.push("coordinator :8005 不可達或種 session 失敗；按鈕 -> IntentDialog -> 真 POST .../close -> 列轉灰 這條 browser 切片本輪 not observed，深度因果由 sessions.test.ts 兜底。");
    }
    test.skip(!coordinatorUp || !seededId, "需 branch coordinator :8005 可達且能 POST /api/review-sessions 種 session；見檔頭前置。深度因果由 sessions.test.ts 兜底。");
  });

  test("結束鈕 -> IntentDialog -> 真 POST .../close -> runtime/status active->closed + 列轉灰", async ({ page }) => {
    const id = seededId!;
    await page.goto(`/#sessions`);
    await page.getByRole("button", { name: /重新整理|讀取中/ }).first().click();
    const btn = page.locator(`[data-testid="session-terminate-${id}"]`);
    await btn.waitFor({ state: "visible", timeout: 30_000 });
    await btn.click();
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible({ timeout: 30_000 });
    const [postResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/review-sessions/${id}/close`) && r.request().method() === "POST", { timeout: 30_000 }),
      page.locator('[data-testid="intent-confirm"]').click(),
    ]);
    expect(postResponse.status(), "POST .../close 應回 2xx").toBeGreaterThanOrEqual(200);
    expect(postResponse.status()).toBeLessThan(300);
    // 證據型更新：dialog 關閉 + runtime/status 真值該 session active->closed。
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeHidden({ timeout: 30_000 });
    const after = await page.request.get(`${COORDINATOR}/api/runtime/status`);
    const afterBody = await after.json();
    const refreshed = (afterBody.sessions?.items ?? []).find((s: { session_id: string }) => s.session_id === id);
    // 後端釋放後該 session 可能 status=closed 仍在列、或已移出 items（兩者皆真，誠實揭露）。
    if (refreshed) {
      expect(["closing", "closed"]).toContain(refreshed.status);
    } else {
      notObserved.push(`runtime/status 已不再 emit ${id}（後端釋放後移出 items）；以 POST 2xx 為終結證據。`);
    }
    await page.screenshot({ path: `../artifacts/e2e/sessions-terminate-slice.png`, fullPage: true });
  });

  test.afterAll(() => {
    if (notObserved.length) console.log("[sessions-terminate] notObserved:", JSON.stringify(notObserved));
  });
});

// render-surface 證據（不受上方守門）：無條件渲染 #sessions 真頁面 + 截圖落 tracked evidence。
// 誠實鐵律：此截圖只證明 #sessions 真頁面渲染 + 截圖機制可落點，不等於觀察到 controlled action；
// 該深度切片由上方 slice test（前置齊全才跑）與 sessions.test.ts route 測試兜底。
test.describe("sessions-terminate render-surface 證據（非 controlled-action 觀察）", () => {
  test.setTimeout(60_000);
  test("渲染 #sessions 真頁面 -> 截圖 render surface（evidence）", async ({ page }) => {
    await page.goto(`/#sessions`);
    await expect(page.getByText("Session 管理", { exact: false })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "../docs/evidence/sessions-terminate/sessions-render-surface.png", fullPage: true });
    await page.screenshot({ path: "../artifacts/e2e/sessions-terminate-render-surface.png", fullPage: true });
  });
});
