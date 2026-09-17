import { expect, test } from "@playwright/test";

// 模型庫合併畫面（#minio）：舊的對齊報表連結會導到該模型，三步驟、轉檔與對齊結果在同一頁。
// 目標是 coordinator 提供的 /ui 與真實 API；只讀不寫（不按轉檔、不開審查）。
// 報表從 API 動態挑選，不寫死任何專案或模型名稱。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

type Ratio = { numerator: number; denominator: number };
type Report = {
  conversion_job_id: string;
  status: string;
  source_ifc: { key: string | null };
  metrics: { rvt_ifc_usdc_lineage_ratio: Ratio } | null;
  counts: { ifc_usdc_unmapped_count: number } | null;
};

test.describe("model-library-merged：模型庫三步驟合併畫面", () => {
  test("舊報表連結導到該模型，第③步顯示指定的那次轉檔", async ({ page, request }) => {
    const list = (await (await request.get(`${COORDINATOR}/api/lineage/conversion-reports?limit=50`)).json()) as { items: Report[] };
    const report = list.items.find((item) => item.status === "generated" && item.source_ifc.key && item.metrics && item.counts);
    test.skip(!report, "coordinator 目前沒有已產出、且記錄來源 IFC 的對齊報表。");
    const { conversion_job_id: id, source_ifc, metrics, counts } = report!;

    const serverErrors: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`${COORDINATOR}/ui#lineage?conversion_job_id=${encodeURIComponent(id)}`);
    await expect(page).toHaveURL(/#minio\?/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /模型庫 · IFC \/ USDC/ })).toBeVisible();
    await expect(page.getByTestId("md-detail-key")).toHaveText(source_ifc.key!, { timeout: 20_000 });

    const steps = page.getByTestId("md-steps").locator("li");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
    await expect(steps.nth(0)).toContainText(source_ifc.key!);
    await expect(steps.nth(1)).not.toHaveAttribute("data-state", "todo", { timeout: 20_000 });

    await expect(page.getByTestId("lineage-result-attempt")).toContainText("已產出", { timeout: 20_000 });
    const select = page.getByTestId("lineage-attempt-select");
    if (await select.count()) await expect(select).toHaveValue(id);

    const lineage = metrics!.rvt_ifc_usdc_lineage_ratio;
    await expect(page.getByTestId("lineage-kpi-rvt_ifc_usdc_lineage_ratio"))
      .toContainText(`${lineage.denominator} 筆 Revit 元件中，${lineage.numerator} 筆可一路追到 USDC`);
    await expect(page.getByTestId("lineage-diff-table")).toHaveCount(0);
    await expect(page.getByTestId("lineage-diff-hint")).toBeVisible();
    await expect(page.getByTestId("lineage-tech-details")).not.toHaveAttribute("open");
    await page.screenshot({ path: "../artifacts/e2e/model-library-merged-detail.png", fullPage: true });

    await page.getByTestId("lineage-kpi-ifc_usdc_coverage_ratio").click();
    await expect(page.getByTestId("lineage-kpi-ifc_usdc_coverage_ratio")).toHaveAttribute("aria-pressed", "true");
    const range = page.getByTestId("lineage-diff-range");
    if (counts!.ifc_usdc_unmapped_count === 0) {
      await expect(range).toContainText("沒有資料");
    } else {
      await expect(range).toContainText(`/ ${counts!.ifc_usdc_unmapped_count}`);
      await expect(page.getByTestId("lineage-diff-row").first()).toBeVisible();
    }
    await page.screenshot({ path: "../artifacts/e2e/model-library-merged-unmapped.png", fullPage: true });

    await page.getByTestId("md-detail-back").click();
    await expect(page.getByTestId("md-empty-guide")).toBeVisible();
    await expect(steps.nth(0)).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("md-recent-report").first()).toBeVisible();
    await expect(page.getByTestId("md-queue-details")).not.toHaveAttribute("open");
    await page.screenshot({ path: "../artifacts/e2e/model-library-merged-picker.png", fullPage: true });

    expect(serverErrors).toEqual([]);
  });

  test("不帶參數的舊報表連結導到模型庫", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#lineage`);
    await expect(page).toHaveURL(/#minio$/, { timeout: 20_000 });
    await expect(page.getByTestId("md-steps")).toBeVisible();
    await expect(page.getByTestId("md-empty-guide")).toBeVisible();
  });
});
