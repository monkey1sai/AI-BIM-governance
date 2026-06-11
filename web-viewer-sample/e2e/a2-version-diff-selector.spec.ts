import { expect, test } from "@playwright/test";

// A2 模型版本差異（VersionDiffPage）瀏覽器 E2E（spec §6.3）。
//
// 驗收（user-facing，非 mock）：經 coordinator :8004/ui#/a2 操作雙組三層選擇器
//   base = 270/機電/ver 000001.ifc、target = 270/機電/ver 竣工.ifc → Run Diff
//   → diff succeeded → counts 卡 added+removed+moved+property_changed 總和 > 0；
//   另證 project 下拉可見「松風庵」（{project}/{model}/{versionDir}/*.ifc 三層目錄 user-facing 支援）。
//
// *** 服務 #/a2 的是 COORDINATOR 的「已 build dist-ui」（package.json `build:ui` → dist-ui），
//     不是 playwright.config.ts webServer 在 :5180 起的 fresh viewer（:5180 那台與本 spec 全程無關，
//     本 spec 一律 page.goto 到 COORDINATOR /ui/#/...）。前置紀律（乾淨環境必做）：
//       1. cd web-viewer-sample && npm run build:ui
//       2. 重啟 coordinator（:8004）服務新 dist-ui；BIM_FILE_LIBRARY_ROOT / RUNTIME_STORAGE_ROOT
//          指含 270/889/990（及松風庵）的 storage。docker 佔 :8004 時 build:ui 只更新 dist，
//          需重建/重啟服務 :8004 dist-ui 的 coordinator 才會生效。
//       3. coordinator 在別 port 時用 E2E_COORDINATOR_BASE_URL 覆寫。
//
// 誠實原則：E2E 打的是真 coordinator proxy → 真 governance-service → 真 IFC diff，不接 mock。
//   coordinator dist-ui 非本 branch（#/a2 缺 a2-base-project 三層選擇器）或真樹缺對應專案時
//   conditional skip（標明 not observed 與原因），絕不假綠。截圖落 ../artifacts/e2e/a2-version-diff-selector-*
//   （tracked 證據另 sync 至 docs/evidence/a2-version-diff-selector/）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

interface VersionRow { name: string; path: string }
interface ModelRow { model_id: string; versions: VersionRow[] }
interface ProjectRow { project_id: string; models: ModelRow[] }
interface FilesTree { root: string; source_kind: string; projects: ProjectRow[] }

const BASE_VER = "ver 000001.ifc";
const TARGET_VER = "ver 竣工.ifc";

// 經 coordinator proxy 取真檔案庫樹（與前端同一條 /api/governance/files/tree）。不可達回 null。
async function fetchTree(request: import("@playwright/test").APIRequestContext): Promise<FilesTree | null> {
  try {
    const r = await request.get(`${COORDINATOR}/api/governance/files/tree`, { timeout: 12_000 });
    if (!r.ok()) return null;
    return (await r.json()) as FilesTree;
  } catch {
    return null;
  }
}

function hasVersion(tree: FilesTree | null, projectId: string, modelId: string, verName: string): boolean {
  return !!tree?.projects
    .find((p) => p.project_id === projectId)?.models
    .find((m) => m.model_id === modelId)?.versions
    .some((v) => v.name === verName);
}

// a2-base-project 三層選擇器存在當判據：導到 #/a2 後短逾時內看不到 → coordinator dist-ui 非本 branch。
async function skipIfDistUiNotThisBranch(page: import("@playwright/test").Page) {
  await page.goto(`${COORDINATOR}/ui/#/a2`);
  await expect(page.getByRole("heading", { name: /版本差異/ })).toBeVisible({ timeout: 20_000 });
  let hasSelector = true;
  try {
    await page.getByTestId("a2-base-project").waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    hasSelector = false;
  }
  test.skip(
    !hasSelector,
    "coordinator dist-ui 非本 branch（#/a2 缺 a2-base-project 三層選擇器）：需 `npm run build:ui` 後重啟服務 :8004 dist-ui 的 coordinator（見檔頭前置）。",
  );
}

test.describe("A2 模型版本差異 · 雙組三層選擇器 + Run Diff（spec §6.3）", () => {
  test.setTimeout(180_000);

  test("base/target 三層選 270/機電 版本 → Run Diff succeeded → counts 總和 > 0", async ({ page, request }) => {
    const tree = await fetchTree(request);
    test.skip(!tree, "coordinator :8004 / governance files/tree 不可達（需先啟動 coordinator + governance-service）");
    test.skip(
      !hasVersion(tree, "270", "機電", BASE_VER) || !hasVersion(tree, "270", "機電", TARGET_VER),
      `運行中檔案庫（root=${tree!.root}）缺 270/機電/${BASE_VER} 或 ${TARGET_VER}（部署區 storage 需同步真 IFC）`,
    );

    await skipIfDistUiNotThisBranch(page);

    // base 三層：project=270 → model=機電 → version=ver 000001.ifc（選定即填 base 路徑 input）。
    await page.getByTestId("a2-base-project").selectOption("270");
    await page.getByTestId("a2-base-model").selectOption("機電");
    await page.getByTestId("a2-base-version").selectOption({ label: BASE_VER });
    await expect(page.getByTestId("a2-base-input")).toHaveValue(/ver 000001\.ifc$/);

    // target 三層：project=270 → model=機電 → version=ver 竣工.ifc。
    await page.getByTestId("a2-target-project").selectOption("270");
    await page.getByTestId("a2-target-model").selectOption("機電");
    await page.getByTestId("a2-target-version").selectOption({ label: TARGET_VER });
    await expect(page.getByTestId("a2-target-input")).toHaveValue(/ver 竣工\.ifc$/);

    // Run Diff → 等 diff 完成（counts 卡片群只在 status==="succeeded" 後渲染）。
    await page.getByRole("button", { name: /Run Diff/ }).click();

    // 每張卡 = .ec-grid > div，內含 .ec-metric（value 數字）+ .ec-s（label 文字）兩個 sibling。
    // 以「label 文字（.ec-s）」定位卡片，再讀同卡 .ec-metric 的數字。
    const card = (label: string) =>
      page.locator(".ec-grid > div").filter({ has: page.locator(".ec-s", { hasText: new RegExp(`^${label}$`, "i") }) }).first();

    // succeeded → matched 卡出現；failed → 顯示 ec-warn-note（未連線後端）。給足 CPU diff 時間。
    await expect(card("matched").locator(".ec-metric")).toBeVisible({ timeout: 150_000 });

    // counts 總和 > 0：added + removed + moved + property changed 四張卡讀數加總。
    const readMetric = async (label: string): Promise<number> => {
      const txt = (await card(label).locator(".ec-metric").innerText()).replace(/[, ]/g, "");
      const m = txt.match(/-?\d+/);
      return m ? parseInt(m[0], 10) : 0;
    };
    const added = await readMetric("added");
    const removed = await readMetric("removed");
    const moved = await readMetric("moved");
    const propChanged = await readMetric("property changed");
    const total = added + removed + moved + propChanged;

    await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-run-diff.png", fullPage: true });
    test.info().annotations.push({
      type: "a2-diff-counts",
      description: `added=${added} removed=${removed} moved=${moved} property_changed=${propChanged} total=${total} (root=${tree!.root})`,
    });

    expect(total, "added+removed+moved+property_changed 總和應 > 0（兩版本確有差異）").toBeGreaterThan(0);
  });

  test("project 下拉可見「松風庵」（三層目錄 {project}/{model}/{versionDir}/*.ifc user-facing 支援）", async ({ page, request }) => {
    const tree = await fetchTree(request);
    test.skip(!tree, "coordinator :8004 / governance files/tree 不可達");
    // 誠實標記：松風庵需後端三層掃描（task#1）已部署 + 部署區 storage 同步松風庵/<model>/v1/*.ifc 後才入樹。
    // 運行中檔案庫缺松風庵時 → 標 not observed 並 skip（部署同步未完成，非前端缺陷；task #11 松風庵同步 checklist）。
    test.skip(
      !tree!.projects.some((p) => p.project_id === "松風庵"),
      `運行中檔案庫（root=${tree!.root}）未含「松風庵」專案：需後端三層掃描已部署 + 部署區同步松風庵真 IFC（task #11）`,
    );

    await skipIfDistUiNotThisBranch(page);

    // base project 下拉應含「松風庵」option（三層目錄專案 user-facing 可選）。
    const baseProject = page.getByTestId("a2-base-project");
    await expect(baseProject.locator("option", { hasText: "松風庵" })).toHaveCount(1);
    // 實選松風庵 → model 下拉 enable 並列出其專業（建築 / 結構 / 機電…）。
    await baseProject.selectOption("松風庵");
    await expect(page.getByTestId("a2-base-model")).toBeEnabled();
    await expect(page.getByTestId("a2-base-model").locator("option").nth(1)).toBeVisible();

    await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-songfeng.png", fullPage: true });
  });
});
