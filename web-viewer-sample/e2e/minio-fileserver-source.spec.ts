import { test, expect } from "@playwright/test";

// MinIO file-server source（storage/{270,889,990}/{機電,水電,消防}/*.ifc）端到端：
// #/minio 真樹可見三專案；#/a1 由選擇器選 270/機電/ver 竣工.ifc → rule-run → 檢核結果出現。
//
// *** 服務這幾頁的是 COORDINATOR 的「已 build dist-ui」（package.json `build:ui` → dist-ui），
//     不是 playwright.config.ts webServer 在 :5180 起的 fresh viewer。:5180 那台與本 spec 全程
//     無關（本 spec 一律 page.goto 到 COORDINATOR /ui/#/...）。前置紀律（乾淨環境必做）：
//       1. cd web-viewer-sample && npm run build:ui    # 用本 branch 的碼重 build dist-ui
//       2. 重啟 coordinator（:8004）讓它服務新的 dist-ui；BIM_FILE_LIBRARY_ROOT 指主 worktree
//          storage（含 270/889/990）。docker 容器佔 :8004 時，build:ui 只更新 dist 不會自動換掉
//          容器內陳舊 dist-ui → 須重建/重啟該服務，否則打到陳舊 UI（已知 gotcha）。
//       3. 若 coordinator 跑在別的 port，用 E2E_COORDINATOR_BASE_URL 覆寫。
//     此前置目前靠人工紀律；beforeEach 會用「本 branch 才有的 UI 標記」守門，環境沒對齊就 skip
//     （誠實：不假裝跑過，也不留下誤導的 locator timeout）。
//
// *** 硬 gate 適用範圍（重要限制，勿誤解效力）：beforeEach 的兩道守門是 conditional skip，
//     亦即「前置缺失 → test.skip → 計為 pass」。在 Playwright 語意裡 skip != fail，所以
//     本 spec 只有在「外部（指揮官 golden-path 或未來 CI setup step）已確保前置滿足、且
//     前置缺失時會讓 build 失敗」的前提下，才提供真正的 P4『硬 gate』效力。若把它丟進一個
//     不保證前置的環境（例如某個只跑 playwright 卻不起 governance-service / 不 build:ui 的
//     CI job），它會在環境未對齊時靜默全 skip 而仍綠燈 → 那是假信心，不是通過。
//     本 repo 現況：.github/workflows 只有 pr-review-agent.yml，無任何 Playwright/e2e job，
//     故此 skip-based 設計不會 false-green 任何既有自動化 gate；此 spec 純屬本機/指揮官手動 gate。
//     若日後要把它升級成 CI 硬 gate：必須在 workflow 加一個「前置必備、缺失即 fail」的 setup
//     step（啟動 governance-service + npm run build:ui + 重啟 coordinator），不能只靠這裡的
//     conditional skip——否則它仍只是個「環境未對齊就靜默跳過」的測試。 ***
//
// 需 coordinator :8004（服務本 branch dist-ui）+ governance-service :49102
// （BIM_FILE_LIBRARY_ROOT 指主 worktree storage）。前置不滿足時 conditional skip。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("MinIO file-server source 端到端", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request, page }) => {
    // 守門 (1)：backend API。files/tree 必須回 270/889/990，否則 skip（檔案庫未備妥）。
    let apiOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      if (res.ok()) {
        const body = await res.json();
        const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
        apiOk = ["270", "889", "990"].every((id) => ids.has(id));
      }
    } catch {
      apiOk = false;
    }
    test.skip(!apiOk, "檔案庫未備妥（需 governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage 含 270/889/990）");

    // 守門 (2)：服務這頁的 coordinator dist-ui 必須是本 branch 的碼。
    // 只驗 API 不夠：backend 備妥但 coordinator dist-ui 仍舊版時，後續 toBeVisible 會逾時失敗，
    // 失敗訊號是 locator timeout 而非「環境未對齊」→ 誤導 debug。改用「本 branch 才有的 UI 標記」
    // a1-fs-project（三層選擇器；main 不存在）當判據：導到 #/a1 後短逾時內看不到即 skip，
    // 讓環境沒對齊走 skip（誠實）而非 timeout，也避免打到陳舊 dist-ui 留下假象。
    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#/a1`);
      await page.getByTestId("a1-fs-project").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch {
      uiOk = false;
    }
    test.skip(
      !uiOk,
      "coordinator dist-ui 非本 branch（#/a1 缺 a1-fs-project 選擇器）：需 `npm run build:ui` 後重啟服務 :8004 dist-ui 的 coordinator（見檔頭前置）。",
    );
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
