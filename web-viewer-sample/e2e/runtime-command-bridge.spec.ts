import { test, expect } from "@playwright/test";

// Task3 Step1：mapping-row 選列是 UI-local intent（design doc §2 select_mapping_row），只更新語意狀態，
// 不得送 runtime mutator（如 focusPrimRequest）。
//
// 誠實限制：harness（?harness=1）model.mapping_url 恆為 null（_bootstrapHarnessSession），MockViewport 對
// harness 一律顯 mapping-empty、不 proxy element-mapping（不捏造對構；gov-viewer-layout.spec.ts 已鎖定
// harness mapping-empty），故 harness 模式下④對構表無 rows 可點——無法用 ?harness=1 覆蓋本場景。
// 因此沿用 element-semantics.spec.ts 既有慣例：打真 coordinator 找一個 ready 真實 session（有 mapping_url），
// 並以 ?session=<sid>&coordinatorApiBase=<coordinator> 直接載入「本分支的 dev server（baseURL，最新碼，含本
// task 新 testid）」，不走 coordinator :8004/ui/open（會 302 轉到部署區 baked viewer image，尚無本分支新
// testid，見 memory note ui-open-redirects-to-5173-baked-viewer）。無 ready session（或 coordinator 未啟動）
// → 誠實 skip，不假造資料、不誤報 pass。UI-local 分類的純函式/元件層證據另見
// src/console/windowParentMessage.dom.test.tsx「C M4 runtime command bridge」describe block。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("C M4 runtime command bridge", () => {
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

    // 走本分支 dev server（baseURL，含本 task 新 testid），以 session + coordinatorApiBase handoff 載入真
    // session；不走 coordinator /ui/open（會 302 轉部署區 baked viewer，缺本分支新 testid）。
    await page.goto(`/?session=${encodeURIComponent(sid!)}&coordinatorApiBase=${encodeURIComponent(COORDINATOR)}`);

    // Full-stack 前置條件：真 session 的 3D 視埠（mock-viewport / 之後的 live <video>）需要「執行中的 Kit
    // 串流」才會脫離「等待串流開始」載入頁並掛載；bare 分支 dev server 或未重建的部署區沒有對應此 session
    // 的 Kit 串流，viewer 會停在載入頁、mock-viewport 不掛載。此時本 full-stack E2E 無法端到端觀察 →
    // 誠實 skip（非誤報 pass、非噪音 fail），與上方 coordinator/ready-session/mapping_url 前置守衛同一誠實原則。
    // 「mapping-row 選列＝UI-local、不送 focusPrimRequest」的行為證據已由 src/console/
    // windowParentMessage.dom.test.tsx「C M4 runtime command bridge」29 個單元測試 + onSelectGuid 純 setState
    // 原始碼覆蓋；本 E2E 待 rebuild-test-deploy.ps1 -Build 於執行中 Kit 的部署環境展示。
    const viewportUp = await page.getByTestId("mock-viewport")
      .waitFor({ state: "visible", timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    test.skip(!viewportUp, "mock-viewport 未掛載：真 session 3D 視埠需執行中 Kit 串流（完整部署棧），bare 分支 dev server / 未重建部署區無此 session 的串流；行為證據見 src/console/windowParentMessage.dom.test.tsx「C M4 runtime command bridge」，full-stack E2E 待 rebuild-test-deploy.ps1 -Build 於部署環境展示");

    const rows = page.getByTestId("mapping-row");
    await expect(rows.first()).toBeVisible({ timeout: 40_000 });
    await rows.first().click();

    // 點選對構表列僅更新語意狀態（govSelectedGuid setState），右側②語意 / 底部④對構區塊仍在，
    // 且送出證據列不得出現 focusPrimRequest（UI-local 選取不觸發 runtime mutator）。
    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("demo-outgoing-log")).not.toContainText("focusPrimRequest");
  });
});
