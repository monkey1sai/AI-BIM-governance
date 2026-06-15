import { test, expect } from "@playwright/test";

// A1/M1 收尾端到端:#/a1 reducer stepper 走真 rule-run → 記分 → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出。
//
// *** 服務這頁的是 COORDINATOR 已 build 的 dist-ui(npm run build:ui → dist-ui),
//     不是 playwright.config.ts 的 fresh viewer(:5180)。前置(乾淨環境必做):
//       1. cd web-viewer-sample && npm run build:ui   # 用本 branch 的碼重 build dist-ui
//       2. 重啟 coordinator(:8004) 服務新 dist-ui;BIM_FILE_LIBRARY_ROOT 指主 worktree
//          storage(含 fixture / 真 IFC)。docker 佔 :8004 時 build:ui 不會自動換容器內
//          陳舊 dist-ui → 須重建/重啟該服務(已知 gotcha)。
//       3. coordinator 跑別的 port 用 E2E_COORDINATOR_BASE_URL 覆寫。
//     此前置靠人工/指揮官紀律;beforeEach 用「本 branch 才有的 a1-step-run」守門,
//     環境沒對齊就 conditional skip(誠實:不假裝跑過,也不留誤導 timeout)。
//
// *** skip-gate 效力限制(誠實揭露,比照 a2-version-diff-selector.spec.ts):
//     beforeEach 兩道是 conditional skip(前置缺失 → skip → Playwright 計 pass)。
//     本 repo .github/workflows 僅 pr-review-agent.yml、無 Playwright job,故 skip 不會
//     false-green 任何既有自動化 gate;此 spec 純屬本機/指揮官手動 P4 硬 gate。
//     ── 最近一次本機 run 的如實結果:**2 skipped**(非 PASS)。原因 = :8004 服務的
//        dist-ui 仍是陳舊 build、缺 a1-step-run testid → line 24 skip 觸發,test body
//        與 page.screenshot() 未執行,故 artifacts/e2e/a1-m1-closeout-{flow,rerun}.png
//        不存在即為「走了 skip 而非 PASS」的鐵證。真 PASS 須先完成上述 build:ui + 重啟。***
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("A1/M1 收尾:#a1 五步 stepper + 失敗抽屜", () => {
  // 重跑 test 最壞路徑 ≈ 第一輪 rule-run 120s + issue/export ~45s + 第二輪 scoreboard 120s ≈ 285s,
  // 180s 會在第二輪前被 global-timeout kill(看不到具體斷言失敗)。拉到 360s 讓慢速第二輪能回報真正失敗點。
  test.setTimeout(360_000);

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try {
      // explicit 10s timeout：APIRequestContext 預設吃 test timeout(此處 180s)，不設會在慢/掛
      // 後端把 30s+ 堆進整體預算，最後以噪音 global-timeout kill 而非乾淨 skip(對齊 a2 fail-fast 慣例)。
      const res = await request.get(`${COORDINATOR}/api/governance/files/tree`, { timeout: 10_000 });
      apiOk = res.ok();
    } catch { apiOk = false; }
    test.skip(!apiOk, "governance proxy 未備妥(需 :49102 + coordinator proxy)");

    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui/#/a1`);
      await page.getByTestId("a1-step-run").waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch { uiOk = false; }
    test.skip(!uiOk, "coordinator dist-ui 非本 branch(#/a1 缺 a1-step-run):需 npm run build:ui 後重啟 :8004。");
  });

  test("選模型 → 自動亮步驟2 → 檢核 succeeded → 展開失敗規則看 GUID/名稱/樓層 → 開 Issue → 匯出", async ({ page }) => {
    await page.getByTestId("a1-step-pick").click();
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });

    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });

    // 先等「scored」信號(RUN_DONE 已落地)再開失敗抽屜的 15s 視窗,縮短不確定性。
    // 記分板在 RUN_PROGRESS(status=queued)就 render(pages.tsx:311 {state.run && …}),但 a1-failures-by-rule 需
    // state.failed.length>0,而 failed 只在 RUN_DONE→scored 才有資料。高負載時 RUN_DONE 可能在記分板可見後數秒~分鐘才到,
    // 若直接從這裡起算 failures-by-rule 的 15s,RUN_DONE 未到就先逾時造成假失敗。a1-step-issues 在 step=scored/issued/
    // delivered 才 enable(pages.tsx:324),即 RUN_DONE 已落地的直接信號;以 120s(對齊 rule-run 量級)等它 enable 後,
    // 失敗抽屜本身只需短視窗即出現。
    await expect(page.getByTestId("a1-step-issues")).toBeEnabled({ timeout: 120_000 });

    // 失敗抽屜:FailureScoreboard 只在 state.failed.length>0 且聚出 rules.length>0 時 render
    // a1-failures-by-rule(pages.tsx:319/804)。fixture-bytes.ifc 有已知失敗(spec §1「A1_EVIDENCE failed:71」),
    // 故此抽屜「必須」出現——這正是 spec §2.2/§6 列為 E2E DoD 必要條件的核心 user-facing 功能(展開看 GUID+名稱+樓層+複製)。
    // 不可用 if(sawDrawer) 包成 optional:那會讓抽屜未現(錯誤 IFC / feature 未 render)時三條斷言全靜默跳過卻仍計 PASS,
    // 使最關鍵閉環驗收失效、違反誠實鐵律。改 hard assert(對齊 a2-version-diff-selector.spec.ts:101 的 expect(...).toBe(true))。
    const byRule = page.getByTestId("a1-failures-by-rule");
    const sawDrawer = await byRule.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
    expect(sawDrawer, "失敗抽屜 a1-failures-by-rule 未在 15s 內出現:fixture 應有已知失敗(failed>0);若環境用錯 IFC/feature 未 render 須先對齊再跑,不得靜默略過 spec §2.2/§6 核心 DoD").toBe(true);
    // 點第一條規則的展開 toggle → 命中構件表出現,含「storey」欄與「複製」鈕(GUID 可複製)。
    // 收窄斷言到「剛展開那條」rule card:從 toggle 的 data-testid 取出 ruleCode,再以 a1-fail-rule-${ruleCode} 定位該 card 的 th,
    // 避免全頁掃 a1-fail-rule-* th 再 .first() 時選到其他(殘留/懶載入)規則行的 th 造成 false positive。
    const firstToggle = page.locator('[data-testid^="a1-fail-toggle-"]').first();
    const toggleId = await firstToggle.getAttribute("data-testid");
    const ruleCode = (toggleId ?? "").replace("a1-fail-toggle-", "");
    expect(ruleCode, "未能從 a1-fail-toggle-* 取得 ruleCode").not.toBe("");
    await firstToggle.click();
    await expect(page.locator(`[data-testid="a1-fail-rule-${ruleCode}"] th`, { hasText: "storey" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "複製" }).first()).toBeVisible({ timeout: 10_000 });

    await expect(page.getByTestId("a1-step-issues")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-issues").click();
    // a1-step-export 在 scored 子態本就 enable(與 a1-step-issues 同 gating),光斷言它 enable
    // 證明不了 issuesFromRuleRun 真的成功——issue 建立失敗時只會冒 a1-action-error、export 仍 enable,測試卻會綠。
    // 故直接驗「已開 issue（artifact）」可見(issueCount 落地的真信號)且無 a1-action-error,才是 issue 真建成的硬證。
    await expect(page.getByText("已開 issue（artifact）")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("a1-action-error")).toBeHidden();
    await expect(page.getByTestId("a1-step-export")).toBeEnabled({ timeout: 10_000 });

    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-flow.png", fullPage: true });
  });

  test("重跑檢核 → 下游(Issue/匯出旗標)清空、已開 Issue artifact 仍在、記分板重建(證據型更新,可重跑不崩)", async ({ page }) => {
    // spec §6 重跑路徑 DoD:回檢核步重跑 → 斷言「下游 Issue/匯出旗標清空、rule-run/issue artifact 仍在」。
    // 先跑完一輪並「開 Issue」產出可保留的下游 artifact,重跑才有東西可驗「清旗標但留 artifact」。
    await page.getByTestId("a1-step-pick").click();
    // 第一次 RUN 前守門:reducer 在 picked 才接受 RUN;直接 click disabled 鈕會無聲無效 → 後面 120s 空等而非明確失敗。
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-run").click();
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });

    // 開 Issue → issued 子態,issueCount 落地為「已開 issue（artifact）」Field(pages.tsx:289,只在 issueCount!==null 顯示)。
    // a1-step-issues 在 step=scored/issued/delivered 才 enable(pages.tsx:327,RUN_DONE→scored 後),高負載/真 IFC
    // 下 RUN_DONE 可能 >5s 才到 → 5s 太短會假失敗。對齊 flow test 的 scored-gate(line 60)用 120_000。
    await expect(page.getByTestId("a1-step-issues")).toBeEnabled({ timeout: 120_000 });
    await page.getByTestId("a1-step-issues").click();
    const issueArtifact = page.getByText("已開 issue（artifact）");
    await expect(issueArtifact).toBeVisible({ timeout: 15_000 });
    // 重跑後仍要驗匯出旗標被清,故先把它推到 delivered(EXPORT_OK)——這樣重跑才能證明 export 下游確實回退 disabled。
    await expect(page.getByTestId("a1-step-export")).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId("a1-step-export").click();
    // doExport 是 async(fetch→blob→dispatch EXPORT_OK);MUST 先等 exported=true 的可見信號(a1-exported-artifact,
    // pages.tsx 僅在 state.exported 顯示)落地,才往下走 rerun。否則重跑的 RUN 會先把 run 清成 null 讓 export 鈕因
    // !runId 而 disabled——那個 disabled 與 EXPORT_OK 是否到達無關,後端慢/離線時 EXPORT_OK 從未觸發測試仍會綠,
    // 根本沒驗到 spec §2.1/§5 要求的「exported=true artifact 於重跑後保留」(a1Machine.ts:106 expect(s.exported).toBe(true))。
    const exportedArtifact = page.getByTestId("a1-exported-artifact");
    await expect(exportedArtifact).toBeVisible({ timeout: 15_000 });

    // 重跑:回檢核步再 RUN。重跑前同樣補 enabled 守門(scored/issued/delivered 態 step-run 應 re-enable,確認非 disabled 才 click)。
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-run").click();

    // RUN 同步把 step→running、run→null(a1Machine.ts:46):running 態下兩個下游鈕回退 disabled(pages.tsx:324/326),
    // 即「下游旗標清空」的直接可觀察信號。real rule-run 需數秒~分鐘,此 running 視窗足以穩定斷言(對齊第一輪 120s 等待量級)。
    await expect(page.getByTestId("a1-step-issues")).toBeDisabled({ timeout: 10_000 });
    await expect(page.getByTestId("a1-step-export")).toBeDisabled({ timeout: 10_000 });
    // 同時:已開 Issue artifact 必須仍可見(a1Machine.ts:86 重跑保留 issueCount)——「清下游旗標但保留已落地 artifact」(PATTERN-EVIDENCE-UPDATE)。
    await expect(issueArtifact).toBeVisible();
    // 已匯出 artifact 同理:RUN 不清 exported(a1Machine.ts:46 spread 保留),故重跑後 exported=true 信號仍在——
    // 這才是真正驗到「exported artifact 重跑後保留」(對齊 a1Machine.ts:106),而非僅旁證 export 鈕 disabled。
    await expect(exportedArtifact).toBeVisible();

    // 重跑收尾:記分板重建(證據型更新,可重跑不崩)。
    await page.getByTestId("a1-rulerun-scoreboard").waitFor({ state: "visible", timeout: 120_000 });
    await page.screenshot({ path: "../artifacts/e2e/a1-m1-closeout-rerun.png", fullPage: true });
  });
});
