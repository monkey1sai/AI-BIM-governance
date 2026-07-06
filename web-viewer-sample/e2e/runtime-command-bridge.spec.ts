import { test, expect } from "@playwright/test";

// Task3 Step1：mapping-row 是 UI-local intent（design doc §2 select_mapping_row），不得送 runtime mutator。
// 誠實限制：harness（?harness=1）model.mapping_url 恆為 null（_bootstrapHarnessSession），
// MockViewport 對 harness 一律不 proxy element-mapping（不捏造對構），故 harness 模式下④對構表無 rows 可點。
// 沿用 element-semantics.spec.ts 既有慣例：打真 coordinator 找一個 ready 真實 session 來驗證，
// 無 ready session（或 coordinator 未啟動）→ 誠實 skip，不假造資料、不誤報 pass。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("C M4 runtime command bridge harness", () => {
  test("primary harness exposes C IA regions and runtime evidence", async ({ page }) => {
    await page.goto("/?harness=1");

    await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("geo-viewer-left-model")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-center-stage")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-runtime-evidence")).toContainText(/PRIMARY|session|first frame/i);
  });

  test("spectator harness is visible but readonly for mutating controls", async ({ page }) => {
    await page.goto("/?harness=1&streamRole=spectator");
    await page.getByTestId("nav-issues").click();

    await expect(page.getByTestId("gov-readonly-banner")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("binding-apply")).toBeDisabled();
    await expect(page.getByTestId("gov-clear")).toBeDisabled();
    await expect(page.getByTestId("geo-viewer-runtime-evidence")).toContainText(/SPECTATOR|session/i);
  });

  test("mapping row selection updates semantic state without sending runtime mutator", async ({ page, request }) => {
    let list: { items?: Array<{ ifc_ready_job_id: string }> };
    try {
      list = await (await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=30`)).json();
    } catch {
      test.skip(true, `coordinator 未啟動或不可達（${COORDINATOR}）；本場景需真實 ready session 才有④對構表 rows 可點，另有 unit 證據見 src/console/windowParentMessage.dom.test.tsx「C M4 runtime command bridge」`);
      return;
    }
    let sid: string | null = null;
    for (const it of (list.items || []).slice(0, 20)) {
      const j = await (await request.get(`${COORDINATOR}/api/external/ifc-ready/${encodeURIComponent(it.ifc_ready_job_id)}`)).json();
      if (j.web_view_session_id && /ready|succeed/i.test(j.conversion_status || "")) { sid = j.web_view_session_id; break; }
    }
    test.skip(!sid, "無 ready 真實 session（需先 register+轉檔）");

    const sc = await (await request.get(`${COORDINATOR}/api/review-sessions/${sid}/stream-config`)).json();
    test.skip(!sc.model?.mapping_url, "ready session 無 mapping_url（④對構表需要）");

    await page.goto(`${COORDINATOR}/ui/open?session=${encodeURIComponent(sid!)}`);
    await expect(page.getByTestId("mock-viewport")).toBeVisible({ timeout: 40_000 });

    const rows = page.getByTestId("mapping-row");
    await expect(rows.first()).toBeVisible({ timeout: 40_000 });
    await rows.first().click();

    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("demo-outgoing-log")).not.toContainText("focusPrimRequest");
  });
});
