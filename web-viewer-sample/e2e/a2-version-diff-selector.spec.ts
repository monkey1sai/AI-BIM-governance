import { test, expect } from "@playwright/test";

// A2 版本 diff 檔案庫選擇器端到端：#/version-diff（IA v2 後 VersionDiffPage 本尊路由；#/a2=unified workspace）由 base/target 三層選擇器選 270/機電 兩版 →
// Run Diff → 真 backend 回 succeeded → counts 卡非全零；且 project 下拉含松風庵、
// 松風庵/建築 版本下拉含三層 v1/japanese_villa_mep.ifc（三層支援 user-facing 證明）。
//
// *** 服務這頁的是 COORDINATOR 已 build 的 dist-ui（npm run build:ui → dist-ui），
//     不是 playwright.config.ts 的 fresh viewer。前置（乾淨環境必做）：
//       1. cd web-viewer-sample && npm run build:ui   # 用本 branch 的碼重 build dist-ui
//       2. 重啟 coordinator(:8004) 服務新 dist-ui；BIM_FILE_LIBRARY_ROOT 指主 worktree
//          storage（含 270/889/990/松風庵）。docker 佔 :8004 時 build:ui 不會自動換容器內
//          陳舊 dist-ui → 須重建/重啟該服務（已知 gotcha）。
//       3. coordinator 跑別的 port 用 E2E_COORDINATOR_BASE_URL 覆寫。
//     此前置靠人工/指揮官紀律；beforeEach 用「本 branch 才有的 a2-base-project」守門，
//     環境沒對齊就 conditional skip（誠實：不假裝跑過，也不留誤導 timeout）。
//
// *** skip-gate 效力限制：beforeEach 兩道是 conditional skip（前置缺失 → skip → 計 pass）。
//     本 repo .github/workflows 僅 pr-review-agent.yml、無 Playwright job，故不會 false-green
//     任何既有自動化 gate；此 spec 純屬本機/指揮官手動 P4 硬 gate。***
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("A2 版本 diff 檔案庫選擇器端到端", () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ request, page }) => {
    // 守門 (1)：backend files/tree 必須含 270（A2 fixture 來源），否則 skip。
    let apiOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      if (res.ok()) {
        const body = await res.json();
        const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
        apiOk = ids.has("270");
      }
    } catch {
      apiOk = false;
    }
    test.skip(!apiOk, "檔案庫未備妥（需 governance-service + BIM_FILE_LIBRARY_ROOT 指主 worktree storage 含 270）");

    // 守門 (2)：coordinator dist-ui 是本 branch（#/version-diff 有 a2-base-project）。
    // 此導航同時是各 test 的唯一導航：成功後 page 已停在 #/version-diff、fsTree 已載入、a2-base-project 可見，
    // test body 直接複用此狀態、不再 page.goto（重複導航會觸發 React unmount/remount + filesTree 重載，
    // 浪費 gate (2) 已建立的狀態並在後端慢時讓 selectOption 的隱含 waitFor 更易逾時）。
    // 註：files/tree API 在 main / 本 branch 相同，無法用純 API 判斷 dist-ui 是否為本 branch，
    //     故此 branch-gate 必須靠 UI 信號（a2-base-project 僅本 branch 有），導航無法省去。
    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#/version-diff`);
      await page.getByTestId("a2-base-project").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch {
      uiOk = false;
    }
    test.skip(!uiOk, "coordinator dist-ui 非本 branch（#/a2 缺 a2-base-project 選擇器）：需 `npm run build:ui` 後重啟 :8004 dist-ui 的 coordinator（見檔頭前置）。");
  });

  test("#/version-diff 選 270/機電 base/target 兩版 → Run Diff → succeeded → counts 非全零", async ({ page }) => {
    // beforeEach 已導航到 #/version-diff 且 a2-base-project 可見、fsTree 已載入；直接複用（不重複 goto）。
    // base：270 / 機電 / ver 000001.ifc（option value=唯一邏輯鍵 {project}/{model}/{version}；
    // library:// 修復後絕對 path 不進瀏覽器，一律用 label 選）。
    await page.getByTestId("a2-base-project").selectOption("270");
    await page.getByTestId("a2-base-model").selectOption("機電");
    await page.getByTestId("a2-base-version").selectOption({ label: "ver 000001.ifc" });
    // target：270 / 機電 / ver 竣工.ifc。
    await page.getByTestId("a2-target-project").selectOption("270");
    await page.getByTestId("a2-target-model").selectOption("機電");
    await page.getByTestId("a2-target-version").selectOption({ label: "ver 竣工.ifc" });

    // 受控 input 被填入版本路徑（controlled → 讀 inputValue，不靠 attribute）。
    await expect(page.getByTestId("a2-base-input")).toHaveValue(/ver 000001\.ifc$/, { timeout: 10_000 });
    await expect(page.getByTestId("a2-target-input")).toHaveValue(/ver 竣工\.ifc$/, { timeout: 10_000 });

    // Run Diff → 真 backend。
    await page.getByRole("button", { name: /Run Diff/ }).click();

    // 等「diff polling loop 結束（落終態或放棄）」——直接觀察 loop 結束的 UI 信號，不用 "matched" 文字當 proxy。
    // 為何不等「套用 3D Overlay」鈕 enable 當 loop-結束信號：該鈕 disabled={busy||diff?.status!=="succeeded"}，
    // busy=false 只在 run() finally 觸發，而 finally 之前 succeeded 分支還 await 了 getDiffItems + diffIssueImpact
    // （pages.tsx L1004–1007）。亦即「鈕 enable」等的不只是 diff loop 結束，還疊加了 items fetch 的 RTT；後端負荷
    // 高、items API 慢時，這個 120s 可能被 items fetch 耗盡，race 兩支都以 false 結算，卻把錯誤報成「diff 未終態」，
    // 誤導人去追 diff 引擎而非 items API（實際上 diff 早就 succeeded）。
    // 改為觀察「diff loop 已結束」本身：run() loop 一 break/跑滿 120 圈就 setDiff(st)，使 {diff && …} 區塊渲染、
    // `matched` Metric（pages.tsx L1080，與 status 同批 setDiff 後立即可見）出現——這個信號不含 items fetch RTT。
    //   loop 結束（succeeded / failed / 跑滿放棄皆會 setDiff）→ `matched` Metric 可見；
    //   createDiff / getDiff throw（未連線後端）→ 錯誤訊息「未連線後端…」（pages.tsx L1077 `{err && …}`）出現。
    // 任一先到即代表 run() 的 diff 階段已結束，整體只有「這一個」120s 長等待，不與 polling 的 120s 疊加爆 180s 預算
    // （beforeEach 15s + 本行 120s + 下方 succeeded gate 30s + evaluate/screenshot 幾秒 < 180s）。
    // 註：「matched 可見」僅蘊含 loop 已結束、不蘊含 status===succeeded（跑滿 120 圈放棄時 st.status 可能仍 running）；
    //    真正的 succeeded 判定交給下方專屬鈕 gate，本步只負責「diff 階段是否在 120s 內收尾」這件事。
    // 兩個 branch 各自 catch 成 boolean（不讓落敗 branch 在 race 結束後丟 unhandled rejection），
    // 再斷言至少一個信號出現；兩者都 120s 未到 = diff loop 真的卡住，sawDiffSettled 為 false 直接失敗。
    const applyOverlayBtn = page.getByRole("button", { name: /套用 3D Overlay/ });
    // matched 標籤是 Metric cell 的 last-child <div class="ec-s">matched</div>（pages.tsx L1080 + components.tsx
    // Metric：<div><div class=ec-metric>{value}</div><div class=ec-s>matched</div></div>）。直接定位 .ec-grid 內
    // 文字恰為 "matched" 的 .ec-s 葉節點（外層 cell 的文字含 value 前綴，不能用整 cell 比對）。#/a2 頁此文字唯一。
    const matchedMetric = page.locator("main .ec-grid .ec-s", { hasText: /^matched$/ });
    const backendErr = page.getByText(/未連線後端/);
    const sawDiffSettled = await Promise.race([
      matchedMetric.waitFor({ state: "visible", timeout: 120_000 }).then(() => true, () => false),
      backendErr.waitFor({ state: "visible", timeout: 120_000 }).then(() => true, () => false),
    ]);
    expect(sawDiffSettled, "diff polling loop 未在 120s 內結束（matched 卡片或未連線錯誤皆未出現）").toBe(true);

    // succeeded 直接 UI gate：上一步已確保 diff loop 結束（setDiff 已跑）。此鈕
    // disabled={busy || diff?.status !== "succeeded"} 是 UI 中唯一直接觀察 status==="succeeded" 的元素。
    // 此處 busy 可能仍為 true（succeeded 分支 finally 前還在 await getDiffItems/diffIssueImpact）——這正是要等的：
    // 30s 給 items fetch 的 RTT 收尾後 busy→false、鈕 enable。逾時設 30s（非 5s）刻意涵蓋後端慢時的 items fetch；
    // 若 status==="failed" 或未連線此鈕永遠不會 enable，30s 後即以「鈕仍 disabled → status 非 succeeded（或 items
    // fetch 逾 30s）」明確炸出，diff 卡片此時已可見於畫面，錯誤明確指向 items/鈕而非把 diff 引擎誤判成 timeout。
    await expect(applyOverlayBtn).toBeEnabled({ timeout: 30_000 });

    // 真實非全零：抓 added/removed/moved/property_changed 四個數字相加 > 0。
    // Metric 結構為 <div><big value></big><label></label></div>；用 evaluate 從 DOM 收 counts。
    const sum = await page.evaluate(() => {
      const labels = ["added", "removed", "moved", "property changed"];
      let total = 0;
      document.querySelectorAll("main .ec-grid > div").forEach((cell) => {
        const label = cell.querySelector("*:last-child")?.textContent?.trim() ?? "";
        if (labels.includes(label)) {
          const num = parseInt(cell.textContent?.replace(label, "").trim() ?? "0", 10);
          if (!Number.isNaN(num)) total += num;
        }
      });
      return total;
    });
    expect(sum).toBeGreaterThan(0); // 8KB vs 22KB 兩版 GlobalId 對齊必有差異（identity 才會全零）。

    await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-diff-counts.png", fullPage: true });
  });

  test("base project 下拉含松風庵；選松風庵/建築 → 版本下拉含三層 v1/japanese_villa_mep.ifc", async ({ request, page }) => {
    // 守門：松風庵真 IFC 須已同步到部署區 storage（task #11 後續部署 checklist），否則 skip。
    // beforeEach 只守 270（A2 主 fixture），不保證 松風庵 已部署；乾淨環境 / CI runner /
    // 重建後未同步 松風庵 時，下方 hasText:"松風庵" toHaveCount(1) 會硬 FAIL（expected 0 to be 1），
    // 與檔頭「前置缺失 → conditional skip」誠實鐵律相違——故此處讀 tree 補上 松風庵 skip-gate。
    let matsuOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`);
      if (res.ok()) {
        const body = await res.json();
        const ids = new Set((body.projects || []).map((p: { project_id: string }) => p.project_id));
        matsuOk = ids.has("松風庵");
      }
    } catch {
      matsuOk = false;
    }
    test.skip(!matsuOk, "需後端三層掃描已部署 + 部署區同步松風庵真 IFC（task #11）");

    // beforeEach 已導航到 #/version-diff 且 fsTree 已載入；直接複用（不重複 goto）。matsuOk 的 API 查詢與
    // 頁面 fsTree 看到的是同一份後端狀態（松風庵 是部署期前置、非 runtime race），複用安全。
    // project 下拉含松風庵（三層 fixture 的 project；需 BIM_FILE_LIBRARY_ROOT 含 storage/松風庵/）。
    const baseProject = page.getByTestId("a2-base-project");
    await expect(baseProject).toBeVisible({ timeout: 30_000 });
    await expect(baseProject.locator("option", { hasText: "松風庵" })).toHaveCount(1);

    // 選松風庵/建築 → 版本下拉含三層 name "v1/japanese_villa_mep.ifc"（三層掃描 user-facing 證明）。
    await baseProject.selectOption("松風庵");
    await page.getByTestId("a2-base-model").selectOption("建築");
    await expect(
      page.getByTestId("a2-base-version").locator("option", { hasText: "v1/japanese_villa_mep.ifc" }),
    ).toHaveCount(1, { timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/a2-version-diff-selector-matsu-three-level.png", fullPage: true });
  });
});
