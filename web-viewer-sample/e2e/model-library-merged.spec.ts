import { expect, test } from "@playwright/test";

// 模型庫合併畫面（#minio）：舊的對齊報表連結會導到該模型，三步驟、轉檔與對齊結果在同一頁。
// 目標是 coordinator 提供的 /ui 與真實 API；只讀不寫（不按轉檔、不開審查）。
// 報表從 API 動態挑選，不寫死任何專案或模型名稱。
const COORDINATOR = process.env.E2E_CONSOLE_BASE_URL || process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

type Ratio = { numerator: number; denominator: number; status: string };
type Report = {
  conversion_job_id: string;
  status: string;
  source_ifc: { bucket: string | null; key: string | null };
  metrics: Record<"rvt_ifc_usdc_lineage_ratio" | "rvt_ifc_alignment_ratio" | "ifc_usdc_coverage_ratio", Ratio> | null;
};

test.describe("model-library-merged：模型庫三步驟合併畫面", () => {
  test("舊報表連結導到該模型，第③步顯示指定的那次轉檔", async ({ page, request }) => {
    const list = (await (await request.get(`${COORDINATOR}/api/lineage/conversion-reports?limit=50`)).json()) as { items: Report[] };
    // 只挑能在模型庫開啟、三個比率都可評估的報表（來源 IFC 仍在同一個 bucket 的資料夾裡）。
    let report: Report | undefined;
    for (const item of list.items) {
      const key = item.source_ifc.key;
      if (item.status !== "generated" || !key || !item.metrics) continue;
      if (Object.values(item.metrics).some((ratio) => ratio.status === "not_evaluable")) continue;
      const folder = key.slice(0, key.lastIndexOf("/") + 1);
      const listing = (await (await request.get(
        `${COORDINATOR}/api/minio/objects?delimiter=%2F&prefix=${encodeURIComponent(folder)}`,
      )).json()) as { bucket: string | null; objects?: Array<{ key: string }> };
      const sameBucket = !item.source_ifc.bucket || listing.bucket === item.source_ifc.bucket;
      if (sameBucket && (listing.objects ?? []).some((object) => object.key === key)) { report = item; break; }
    }
    test.skip(!report, "coordinator 目前沒有能在模型庫開啟、且比率可評估的對齊報表。");
    const { conversion_job_id: id, source_ifc, metrics } = report!;
    const unmapped = (await (await request.get(
      `${COORDINATOR}/api/lineage/conversion-reports/${encodeURIComponent(id)}/differences?set=ifc_usdc_unmapped&offset=0&limit=1`,
    )).json()) as { total: number };

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
    await expect(page.getByTestId("lineage-kpi-ifc_usdc_coverage_ratio")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("lineage-diff-title")).toHaveText("USDC 沒有對應的 IFC 元件");
    const range = page.getByTestId("lineage-diff-range");
    if (unmapped.total === 0) {
      await expect(range).toContainText("沒有資料");
    } else {
      await expect(range).toContainText(`/ ${unmapped.total}`);
      await expect(page.getByTestId("lineage-diff-row").first()).toBeVisible();
    }
    await page.screenshot({ path: "../artifacts/e2e/model-library-merged-unmapped.png", fullPage: true });

    await page.getByTestId("md-detail-back").click();
    await expect(page.getByTestId("md-empty-guide")).toBeVisible();
    await expect(steps.nth(0)).toHaveAttribute("data-state", "active");
    await expect(page.getByTestId("md-recent-reports")).toBeVisible();
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
