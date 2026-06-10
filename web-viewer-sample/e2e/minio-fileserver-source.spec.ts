import { test, expect } from "@playwright/test";

// MinIO file-server source（storage/{270,889,990}/{機電,水電,消防}/*.ifc）端到端：
// #/minio 真樹可見三專案；#/a1 由選擇器選 270/機電/ver 竣工.ifc → rule-run → 檢核結果出現。
// 需 coordinator :8004 + governance-service :49102（BIM_FILE_LIBRARY_ROOT 指主 worktree storage）。
// 前置不滿足時 conditional skip（誠實：不假裝跑過）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("MinIO file-server source 端到端", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request }) => {
    // 前置守門：files/tree 必須回 270/889/990，否則 skip（環境未備妥）。
    let ok = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      if (res.ok()) {
        const body = await res.json();
        const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
        ok = ["270", "889", "990"].every((id) => ids.has(id));
      }
    } catch {
      ok = false;
    }
    test.skip(!ok, "檔案庫未備妥（需 governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage 含 270/889/990）");
  });

  test("#/minio 真樹可見 270/889/990 三專案與版本檔", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/?route=minio`);
    // EdgeConsole 以 hash route 切頁；直接導 hash 確保到 minio 頁。
    await page.goto(`${COORDINATOR}/ui/#/minio`);

    // 檔案庫 Panel 載入真樹後，三個 project_id 應可見。
    // 注意：getByText 可能在頁面多處命中（樹節點 + 其他文案）→ 一律 .first() 避免
    // Playwright strict-mode（locator 解析到 >1 element 時 toBeVisible 會直接拋錯而非判可見）。
    // 樹節點實作為 <span className="ec-tree-file">{project_id}/</span>，故用 main .ec-tree 收斂範圍 + .first()。
    const tree = page.locator("main .ec-tree");
    await expect(tree.getByText("270/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(tree.getByText("889/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    await expect(tree.getByText("990/", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
    // 誠實標記：local file-server 文案存在（lead 段 + Panel 副標可能多重命中 → .first()）。
    await expect(page.getByText("local file-server", { exact: false }).first()).toBeVisible();
    // 版本檔（竣工）可見（多專案/多模型下「ver 竣工.ifc」會多重命中 → .first()）。
    await expect(tree.getByText("ver 竣工.ifc", { exact: false }).first()).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: "../artifacts/e2e/minio-fileserver-source-minio-tree.png", fullPage: true });
  });

  test("#/a1 選擇器選 270/機電/ver 竣工.ifc → rule-run → 檢核結果出現", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/#/a1`);

    // #/a1 是 A1GovernanceWorkbenchPage，內嵌兩個 a1-* slice（a1-real-ifc-slice +
    // a1-rule-center-slice）。選擇器與 live-run 記分板都在 a1-rule-center-slice 內，
    // 用 section 收斂範圍，避免與 a1-real-ifc-slice 的同名元素/文案衝突（strict-mode）。
    const ruleCenter = page.getByTestId("a1-rule-center-slice");

    // 三層選擇器可見並依序選擇。
    const projectSel = ruleCenter.getByTestId("a1-fs-project");
    await expect(projectSel).toBeVisible({ timeout: 30_000 });
    await projectSel.selectOption("270");
    await ruleCenter.getByTestId("a1-fs-model").selectOption("機電");
    // version 的 value 是絕對路徑；用 label（檔名）選。
    await ruleCenter.getByTestId("a1-fs-version").selectOption({ label: "ver 竣工.ifc" });

    // 選定後 ifcPath 受控輸入框應被填入該檔絕對路徑（controlled input → 讀 inputValue()，
    // 不靠 [value=...] attribute selector；React controlled input 不一定反映 value attribute）。
    // rule-run authority Panel 的第一個 <input> 即 ifcPath 框（見 pages.tsx L635）。
    const ifcInput = ruleCenter.locator("input").first();
    await expect(ifcInput).toHaveValue(/ver 竣工\.ifc$/, { timeout: 10_000 });

    // 跑 rule-run（rule-run authority Panel 內的「執行規則檢核」按鈕）。
    await ruleCenter.getByRole("button", { name: /執行規則檢核/ }).click();

    // *** 關鍵硬 gate：只斷言 live-run 記分板（data-testid="a1-rulerun-scoreboard"），
    //     此區塊僅在後端真的回 succeeded（run!=null）後才渲染（pages.tsx `{run && (...)}`）。
    //     絕對不可改用 getByText("評估構件"/"score")：頁面有兩個恆顯記分板（A1 workbench
    //     L210-216 + artifact baseline L582-588）都帶這些 label，會讓斷言永遠假綠且觸發
    //     strict-mode 多重命中。a1-rulerun-scoreboard 是「真 run vs baked baseline」的唯一判別。 ***
    const liveScoreboard = ruleCenter.getByTestId("a1-rulerun-scoreboard");
    await expect(liveScoreboard).toBeVisible({ timeout: 120_000 });
    // 區塊內含 score 指標 → 確認真結果而非空殼。
    await expect(liveScoreboard.getByText("score", { exact: false })).toBeVisible();
    // rule_run_status 翻成 succeeded（誠實：真的跑完，非只是出現空表）。
    await expect(ruleCenter.getByText("succeeded", { exact: false }).first()).toBeVisible({ timeout: 120_000 });

    await page.screenshot({ path: "../artifacts/e2e/minio-fileserver-source-a1-rulerun.png", fullPage: true });
  });
});
