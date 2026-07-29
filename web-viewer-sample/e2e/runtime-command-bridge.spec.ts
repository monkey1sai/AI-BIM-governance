import { test, expect } from "@playwright/test";
import { harnessRoute } from "./harnessRoute";

// Task3 Step1（2026-07-06 plan 修正，supersedes 先前「打真 coordinator + test.skip」版本）：
// mapping-row 選列是 UI-local intent（design doc §2 select_mapping_row），只更新語意狀態，
// 不得送 runtime mutator（如 focusPrimRequest）。
//
// 先前版本因 harness model.mapping_url 恆為 null 而無 row 可點，改打真 coordinator + 誠實 skip。
// 使用者裁決不接受：harness 本身要能提供可點的 demo mapping row。解法（Step0）：harness 注入一份
// 標記為 fake 的 in-memory mapping fixture（src/harness/fixtures/harnessMapping.ts），沿用
// MappingTable 既有 fake-mapping 誠實標示機制（mapping-fake badge + 逐列 fake 標示），不冒充真實
// 對映、不新增網路請求。故本測試現在字面可執行，於 ?harness=1 下真的點擊 mapping-row。
test.describe("C M4 runtime command bridge", () => {
  test("mapping row selection updates semantic state without sending runtime mutator", async ({ page }) => {
    await page.goto(harnessRoute());
    await page.getByTestId("mapping-row").first().click();
    await expect(page.getByTestId("geo-viewer-right-semantic")).toBeVisible();
    await expect(page.getByTestId("geo-viewer-bottom-mapping")).toBeVisible();
    await expect(page.getByTestId("demo-outgoing-log")).not.toContainText("focusPrimRequest");
  });
});
