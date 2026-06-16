import { test, expect } from "@playwright/test";

// M2-a #conv 轉檔 coverage 報告展開 端到端：#conv「Refresh queue」→ 對一筆已派工
// （conversion_job_id 非 null、conversion_status=succeeded）的 ifc-ready job 點「coverage」
// 展開鈕 → 抽屜懶載入 coordinator production 唯讀路由
// GET /api/conversions/:id/quality-metrics（coordinator → real conversion authority
// /result → buildQualityMetricsSummary 原樣）→ 斷言抽屜顯示後端真 coverage_ratio×100
// + coverage_status + mapped/unmapped + usdc 輸出路徑。誠實鐵律：coverage 後端原樣、
// 前端零計算；三項拆分顯「後端未提供」。
//
// *** 服務這頁的 viewer 來源（與既有 a2 / minio spec 的 dist-ui 模式不同，故另記）：
//     本 spec 走 playwright.config.ts webServer 在 :5180 起的 fresh viewer（本 branch 最新碼），
//     並由 webServer 的 VITE_COORDINATOR_API_BASE 把 viewer 的 coordinator client base 指向
//     branch-isolated coordinator（預設 http://127.0.0.1:8005，可用 E2E_COORDINATOR_BASE_URL 覆寫）。
//     前置（乾淨環境必做，靠人工/指揮官紀律或 setup script）：
//       1. 起 branch coordinator（PORT=8005、STREAMING_CONVERSION_API_BASE 指向會回真 result 的
//          conversion authority、CORS_ORIGINS 含 http://127.0.0.1:5180）。
//       2. 該 coordinator 的 ifc-ready 佇列須至少有一筆已派工 job（conversion_job_id 非 null +
//          conversion_status=succeeded），且其 conversion_job_id 在 authority /result 可取回含
//          quality_metrics 的真 result（本輪用 2026-06-02 真 IFC→USDC 持久化結果 replay，非 mock）。
//       3. webServer 啟動時 VITE_COORDINATOR_API_BASE 須等於該 coordinator base（playwright.config
//          已用 process.env 透傳；缺省 8005）。
//
// *** skip-gate 效力限制（比照 a2 / minio spec）：beforeEach 守門是 conditional skip
//     （前置缺失 → skip → 計 pass，非 fail）。本 repo .github/workflows 僅 pr-review-agent.yml、
//     無任何 Playwright/e2e job，故此 skip 設計不會 false-green 任何既有自動化 gate；純屬本機 /
//     指揮官手動 P4 gate。若日後升級為 CI 硬 gate，必須在 workflow 加「前置必備、缺失即 fail」的
//     setup step（起 authority + coordinator + 派工真 job），不能只靠這裡的 conditional skip。***
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

interface IfcReadyJob {
  ifc_ready_job_id: string;
  conversion_job_id: string | null;
  conversion_status: string | null;
}

test.describe("M2-a #conv 轉檔 coverage 報告展開", () => {
  test.setTimeout(120_000);

  let readyJob: IfcReadyJob | null = null;

  test.beforeEach(async ({ request }) => {
    // 守門：coordinator 可達且 ifc-ready 佇列有一筆已派工（succeeded）job，否則 honest skip。
    let job: IfcReadyJob | null = null;
    try {
      const res = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=50`);
      if (res.ok()) {
        const body = await res.json();
        const items: IfcReadyJob[] = body.items ?? [];
        job =
          items.find(
            (j) => j.conversion_job_id && j.conversion_status === "succeeded",
          ) ?? null;
      }
    } catch {
      job = null;
    }
    test.skip(
      !job,
      "需先有已轉檔 job（conversion_job_id 非 null + conversion_status=succeeded）於 branch coordinator :8005；見檔頭前置。",
    );
    readyJob = job;
  });

  test("#conv Refresh → 展開已轉檔 job → 抽屜顯後端真 coverage + mapped/unmapped + usdc 路徑", async ({
    page,
  }) => {
    const job = readyJob!;
    // viewer 由 webServer 起在 :5180（baseURL），coordinator base 由 VITE_COORDINATOR_API_BASE 注入。
    await page.goto(`/#conv`);

    // Refresh queue（GET /api/external/ifc-ready）—— 載入佇列。
    const refresh = page.getByRole("button", { name: /Refresh queue|讀取中/ });
    await refresh.waitFor({ state: "visible", timeout: 30_000 });
    await refresh.click();

    // 該 job 的 coverage 展開鈕（穩定 testid）出現即代表佇列已載入且該列有 conversion_job_id。
    const toggle = page.locator(
      `[data-testid="conv-coverage-toggle-${job.ifc_ready_job_id}"]`,
    );
    await toggle.waitFor({ state: "visible", timeout: 30_000 });
    await toggle.click();

    // 展開抽屜：懶載入 GET /api/conversions/:id/quality-metrics（coordinator → real authority /result）。
    const drawer = page.locator(`[data-testid="conv-coverage-${job.ifc_ready_job_id}"]`);
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    // 後端真 coverage：coverage_ratio×100（%）+ coverage_status；不得是「未取得」。
    await expect(drawer).toContainText(/%/, { timeout: 30_000 });
    const drawerText = (await drawer.textContent()) ?? "";
    expect(drawerText).toMatch(/\d+(\.\d+)?%/); // coverage_ratio×100 真百分比
    expect(drawerText).toMatch(/pass|warn/); // coverage_status 字串
    expect(drawerText).toContain("mapped"); // mapped / unmapped 欄
    expect(drawerText).toContain(".usdc"); // usdc 輸出路徑
    expect(drawerText).toContain("未提供"); // 三項拆分誠實標（property/relationship/attribute）

    await page.screenshot({
      path: `../artifacts/e2e/conv-coverage-report-conv-drawer.png`,
      fullPage: true,
    });
  });
});
