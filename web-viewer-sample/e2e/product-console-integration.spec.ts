import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

// IA v2（UnifiedConsole）：/ui 預設頁與 #a1..#a10 / #conv / #runtime 改掛新殼（UnifiedShell），
// 新殼依設計稿無 ChatUSD agent 欄 / FlowBar / SharedStatusRail；legacy 鍵（#sessions / #instances /
// #minio / #viewer …）保留舊殼，ChatUSD 欄斷言隨之移到 legacy 路由驗證。
test.describe("Product AI-BIM Governance console integration", () => {
  test("operator can navigate unified + legacy product console pages", async ({ page }) => {
    const severeConsole: string[] = [];
    page.on("console", (msg) => {
      if (["error"].includes(msg.type())) severeConsole.push(msg.text());
    });
    page.on("pageerror", (err) => severeConsole.push(err.message));

    // /ui → UnifiedConsole home：側欄兩群組（工作台 / AI 應用模組）＋ 10 個 A 項（fixtures.ts apps）。
    await page.goto(`${COORDINATOR}/ui`);
    await expect(page.getByText("總覽 · Mission Control")).toBeVisible();
    // 側欄容器＝UnifiedShell sidebar（唯一 width:212px 欄；inline style 為設計稿 byte-identical 凍結值）。
    const sidebar = page.locator('div[style*="width: 212px"]');
    await expect(sidebar.getByText("工作台", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("AI 應用模組", { exact: true })).toBeVisible();
    for (const code of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]) {
      await expect(sidebar.getByText(code, { exact: true })).toBeVisible();
    }

    // #/a1 → UnifiedShell workspace dock A1：規則集清單 ＋ 執行鈕（initialFlags.a1Ran=true → 重新執行）。
    await page.goto(`${COORDINATOR}/ui#/a1`);
    await expect(page.getByText("A1 治理檢核").first()).toBeVisible(); // dock tab（與 dock 標題同文案）
    await expect(page.getByText("規則集", { exact: true })).toBeVisible();
    await expect(page.getByText("重新執行", { exact: true })).toBeVisible();

    // #/viewer → legacy 3D Viewer 呈現頁（保留舊殼斷言）。
    await page.goto(`${COORDINATOR}/ui#/viewer`);
    await expect(page.getByRole("heading", { name: /3D Viewer/ })).toBeVisible();
    await expect(page.locator("main").getByText("DataChannel", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main").getByText("highlightPrimsRequest", { exact: true }).first()).toBeVisible();

    // #/conv → UnifiedConsole Pipeline 頁（不再導 #minio；fixtures.ts getL().pipe_title）。
    await page.goto(`${COORDINATOR}/ui#/conv`);
    await expect(page.getByText("模型資料與轉檔生產線")).toBeVisible();
    await expect(page.getByText("⑤ Callback Outbox")).toBeVisible();

    // #/sessions → legacy Session 管理（舊殼斷言維持）＋ legacy 殼專屬元素：
    // 兩段式 nav 群組與 ChatUSD agent 欄（新殼依設計稿無 agent 欄，斷言移到 legacy 路由）。
    await page.goto(`${COORDINATOR}/ui#/sessions`);
    await expect(page.getByRole("heading", { name: /Session 管理/ })).toBeVisible();
    await expect(page.locator("main").getByText(/first frame/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Reclaim stale spectator/ })).toBeVisible();
    await expect(page.getByText("核心治理")).toBeVisible();
    await expect(page.getByText("OMNIVERSE RUNTIME")).toBeVisible();
    await expect(page.getByText("落地端控制台")).toBeVisible();
    await expect(page.getByText("Chat USD Agent")).toBeVisible();

    // #/instances → legacy Kit / GPU 機隊（維持）。
    await page.goto(`${COORDINATOR}/ui#/instances`);
    await expect(page.getByRole("heading", { name: /Kit \/ GPU 機隊/ })).toBeVisible();
    await expect(page.locator("main").getByText("1 GPU = 1 Kit stream", { exact: true }).first()).toBeVisible();

    // #/minio → legacy ModelDataPage（MD 三頁合一後的實際 h1＝「模型資料與轉檔」；舊斷言的
    // 「MinIO 資料」h1 與 .ec-tree 內 "bim-control/"/"model.usdc" 屬已刪除的舊 MinioDataPage DOM 且
    // 依賴 live bucket 內容——改斷言合一頁的確定性結構：檔案樹 Panel 標題＋全域轉檔統計。
    // 真實 bucket 資料的斷言由 minio-closed-loop / minio-fileserver-source spec 擁有。
    await page.goto(`${COORDINATOR}/ui#/minio`);
    await expect(page.getByRole("heading", { name: /模型資料與轉檔/ })).toBeVisible();
    await expect(page.getByText("MinIO Bucket 逐層資料夾（真實 list）")).toBeVisible();
    await expect(page.getByTestId("md-conversion-stats")).toBeVisible();

    await page.screenshot({ path: "../artifacts/e2e/product-governance-console-integration.png", fullPage: true });
    // 零 console error 維持嚴格：unified 頁為 fixture 語意、不打任何 /api（UnifiedShell 註記），
    // 不會產生 503/fetch console error；legacy 頁行為與改版前相同。
    expect(severeConsole).toEqual([]);
  });
});
