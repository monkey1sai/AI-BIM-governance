import { test, expect } from "@playwright/test";

// CH-H2：點構件 → ②IFC語意（Pset/Type）+ ⑥空間關係（真實 ifcopenshell，經 coordinator for-session proxy）。
// 用真實 ready session（real-ifc register 產生）開 viewer → 點④對構表構件 → ②⑥ 出現真實語意。
// 誠實：無 ready session 時 conditional skip（endpoint pytest + proxy vitest + 全鏈 node smoke 另有證據）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("CH-H2：點構件 → ②IFC語意 + ⑥空間（for-session 真實語意）", () => {
  test.setTimeout(120_000);

  test("ready 真實 session 開 viewer → 點對構表構件 → ②Pset/Type + ⑥空間 + ⑤roadmap", async ({ page, request }) => {
    const list = await (await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=30`)).json();
    let sid: string | null = null;
    for (const it of (list.items || []).slice(0, 20)) {
      const j = await (await request.get(`${COORDINATOR}/api/external/ifc-ready/${encodeURIComponent(it.ifc_ready_job_id)}`)).json();
      if (j.web_view_session_id && /ready|succeed/i.test(j.conversion_status || "")) { sid = j.web_view_session_id; break; }
    }
    test.skip(!sid, "無 ready 真實 session（需先 register+轉檔）；CH-H2 endpoint pytest + proxy vitest + node 全鏈 smoke 另有證據");

    const sc = await (await request.get(`${COORDINATOR}/api/review-sessions/${sid}/stream-config`)).json();
    test.skip(!sc.model?.mapping_url, "ready session 無 mapping_url（④對構表需要）");

    await page.goto(`${COORDINATOR}/ui/open?session=${encodeURIComponent(sid!)}`);

    // 中央 mock viewport（無 GPU 幀時的語意視圖）+ ④對構表真實 rows。
    await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 40_000 });
    const rows = page.getByTestId("mapping-row");
    await expect(rows.first()).toBeVisible({ timeout: 40_000 });

    // 點第一列構件 → 選 guid → ②IFC語意 經 for-session proxy 取真實語意。
    await rows.first().click();
    await expect(page.getByTestId("ifc-semantic-view")).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId("sem-attrs")).toContainText("IFC Type");
    await expect(page.getByTestId("sem-spatial")).toBeVisible();
    await expect(page.getByTestId("sem-roadmap")).toBeVisible(); // ⑤幾何/分類碼誠實 roadmap

    await page.screenshot({ path: "../artifacts/e2e/element-semantics.png", fullPage: true });
  });
});
