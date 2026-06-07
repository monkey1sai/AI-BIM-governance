import { test, expect } from "@playwright/test";

// 完整問題分頁：viewer 模型↔問題 分頁切換。模型=語意檢視（mock viewport/3D）；問題=全幅治理面板（GovernanceOverlay）。
// 真實 session 開 viewer 驗切換；無 ready session 時 conditional skip（unit/harness 另有證據）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("完整問題分頁：模型↔問題 分頁切換（全幅治理）", () => {
  test.setTimeout(120_000);

  test("真實 session 開 viewer → 切問題分頁全幅治理 → 切回模型語意檢視", async ({ page, request }) => {
    const list = await (await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=30`)).json();
    let sid: string | null = null;
    for (const it of (list.items || []).slice(0, 20)) {
      const j = await (await request.get(`${COORDINATOR}/api/external/ifc-ready/${encodeURIComponent(it.ifc_ready_job_id)}`)).json();
      if (j.web_view_session_id && /ready|succeed/i.test(j.conversion_status || "")) { sid = j.web_view_session_id; break; }
    }
    test.skip(!sid, "無 ready 真實 session（需先 register+轉檔）");

    await page.goto(`${COORDINATOR}/ui/open?session=${encodeURIComponent(sid!)}`);

    // 模型分頁（預設）：分頁列 + mock viewport 語意檢視
    await expect(page.getByTestId("gv-nav")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("nav-model")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 40_000 });

    // 切「問題」分頁 → 全幅治理面板（gov-overlay）出現、mock viewport 隱
    await page.getByTestId("nav-issues").click();
    await expect(page.getByTestId("nav-issues")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("gov-overlay")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("mock-viewport")).toHaveCount(0);

    await page.screenshot({ path: "../artifacts/e2e/issues-tab.png", fullPage: true });

    // 切回「模型」→ 語意檢視回來
    await page.getByTestId("nav-model").click();
    await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 20_000 });
  });
});
