import { test, expect } from "@playwright/test";

// gap-a4-closeout 取證 spec：#a4 語意查詢 B 閉環（deterministic）＋誠實邊界。
//
// *** 啟法＝PROCESS §3 branch-isolated stack（未 merge 分支不得碰部署區 :8004/:49102）：
//       1. cd web-viewer-sample &&（帶 VITE_COORDINATOR_API_BASE=http://127.0.0.1:8005）npm run build:ui
//          —— env.ts 的 build-time fallback 是 :8004，不帶 env 重 build 會讓 dist-ui 打部署區。
//       2. branch governance :49103（GOV_PORT=49103＋fresh GOV_DB_PATH＋BIM_FILE_LIBRARY_ROOT）
//       3. branch coordinator :8005（PORT=8005＋CONSOLE_DIST_DIR=本 branch dist-ui＋GOVERNANCE_API_BASE=:49103）
//       4. E2E_DISABLE_WEBSERVER=1 E2E_COORDINATOR_BASE_URL=http://127.0.0.1:8005 \
//          A4_E2E_IFC_PATH=<host 真實 IFC 絕對路徑> npx playwright test e2e/a4-closeout.spec.ts
//
// *** skip-gate 效力限制（誠實揭露，比照 a1-m1-closeout.spec.ts）：前置缺失 → conditional skip
//     → Playwright 計 pass。skip 不會 false-green 任何既有自動化 gate；真 PASS 的鐵證是
//     artifacts/e2e/a4-trace/ 下的截圖與 trace 存在且 tracked。
//
// *** BCF 邊界（BACKLOG 2026-07-15 裁決＝不建 bridge）：批次建 Issue 走 source_type=manual，
//     訊息必須明示「A4 尚無 BCF provenance bridge」——本 spec 把這句當硬斷言，不偽稱 BCF 可用。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const IFC_PATH = process.env.A4_E2E_IFC_PATH || "";

test.describe("A4 closeout：#a4 deterministic 查詢＋誠實邊界", () => {
  // 89MB 真 IFC 掃描實測 ~7.4s（本機 :49103），高負載給 120s；兩段查詢＋72 筆 issue POST，總預算 240s。
  test.setTimeout(240_000);

  test.beforeEach(async ({ request, page }) => {
    test.skip(!IFC_PATH, "A4_E2E_IFC_PATH 未設（需 host 上真實 IFC fixture 絕對路徑；不得改用 mock）");

    let apiOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/search/llm-status`, { timeout: 10_000 });
      apiOk = res.ok();
    } catch {
      apiOk = false;
    }
    test.skip(!apiOk, "governance search proxy 未備妥（需 :49103 governance＋:8005 coordinator）");

    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#a4`);
      await page.getByTestId("a4-semantic-search-page").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch {
      uiOk = false;
    }
    test.skip(!uiOk, "coordinator dist-ui 非本 branch 或未起（#a4 缺 a4-semantic-search-page）：需帶 :8005 env 重跑 build:ui 後重啟 :8005");
  });

  test("path 來源 → deterministic 查詢 → interpreted filters/結果表 → 批次建 Issue（manual；BCF bridge 誠實 unavailable）", async ({ page }) => {
    // PROCESS §3 network 面斷言：本頁只許打 coordinator（:8005）的 /api/* proxy；:49102 直連或部署區 :8004＝違規。
    const badCalls: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes(":49102") || u.includes(":8004")) badCalls.push(u);
    });

    // 誠實邊界：隔離站未設 ORNITH_API_KEY → llm-status configured=false，頁面必須顯示降級警示、
    // 不阻斷頁面、不偽稱 semantic 可用（BACKLOG gap-a4-closeout 誠實邊界欄）。
    await expect(page.getByTestId("a4-llm-missing")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("a4-source-path").click();
    await page.getByTestId("a4-path-input").fill(IFC_PATH);
    await page.getByTestId("a4-mode-deterministic").click();
    await page.getByTestId("a4-query-input").fill("IfcDoor");

    await expect(page.getByTestId("a4-run")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a4-run").click();

    // 結果表出現真列＝governance 真實 API 回傳（fixture-bytes.ifc 已知含 72 樘 IfcDoor）。
    await expect(page.getByTestId("a4-results-table").locator("tbody tr")).not.toHaveCount(0, { timeout: 120_000 });
    // 可解釋性：interpret_source 與 deterministic 文法 confidence basis 必須可見（confidence 有基礎才顯示）。
    await expect(page.getByText("interpret_source").first()).toBeVisible();
    await expect(page.getByText("deterministic_grammar").first()).toBeVisible();

    // 批次建 Issue：manual source；BCF bridge 誠實 unavailable（不偽成功）。
    await page.getByTestId("a4-select-all").click();
    await expect(page.getByTestId("a4-create-issues")).toBeEnabled();
    await page.getByTestId("a4-create-issues").click();
    const issueMsg = page.getByTestId("a4-issue-msg");
    await expect(issueMsg).toContainText("source_type=manual", { timeout: 90_000 });
    await expect(issueMsg).toContainText("BCF provenance bridge");

    expect(badCalls, "不得直連 :49102 或部署區 :8004（PROCESS §3 network 面斷言）").toEqual([]);
    await page.screenshot({ path: "../artifacts/e2e/a4-trace/a4-closeout-flow.png", fullPage: true });
  });

  test("誠實 fallback：0 筆／不可解譯顯明確警示，不偽造結果列", async ({ page }) => {
    await page.getByTestId("a4-source-path").click();
    await page.getByTestId("a4-path-input").fill(IFC_PATH);
    await page.getByTestId("a4-mode-deterministic").click();
    // fixture 無此類（或文法不可解譯）→ 兩種誠實路徑都必須以 a4-run-err 顯式表態，結果表維持「無列」。
    await page.getByTestId("a4-query-input").fill("IfcSpaceHeater");
    await expect(page.getByTestId("a4-run")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a4-run").click();
    await expect(page.getByTestId("a4-run-err")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("a4-results-table")).toContainText("無列");
    await page.screenshot({ path: "../artifacts/e2e/a4-trace/a4-closeout-empty-honest.png", fullPage: true });
  });
});
