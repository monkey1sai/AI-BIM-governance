import { test, expect } from "@playwright/test";

// IA v2（UnifiedConsole）後的 user-facing 驗證（純前端；不需 coordinator / governance）：
//   1. #a9  → UnifiedConsole ConceptPage：標題＝conceptMeta.a9.titleZh「A9 · 機器人 / 自主巡檢」
//   2. #a10 → ConceptPage：標題＝conceptMeta.a10.titleZh「A10 · 其他應用 / AI 決策」
//   3. ChatUSD 全域右欄（ROADMAP · A10）只存在 legacy 殼 → 斷言移到 legacy 路由（#sessions）
//   4. #apps 的 A1 卡片導向 #a1；hash 不變，落點改為 UnifiedShell workspace（dock A1）
//   5. #/workspace?dock=a4 是唯一 A4 surface；legacy alias 只做無資料 redirect，
//      並保留 source／解譯模式按鈕的 primary styling coverage。
//
// 服務者＝playwright.config.ts 的 webServer（vite dev :5180），本 branch 的碼。
// a9/a10 為 unified concept 佔位頁（fixture 語意，不打任何 /api）→ 零頁面級 /api 斷言保留並收緊。

const SHOT = "../artifacts/e2e/a9-a10-identity-a4-primary";

test.describe("A9/A10 route 身分、ChatUSD legacy 欄、A1 卡片導向、A4 選中高亮", () => {
  test("#a9 顯示機器人／自主巡檢 ConceptPage；佔位頁零 /api 呼叫", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/")) apiCalls.push(r.url());
    });

    await page.goto("/#a9");
    // ConceptPage 標題為 span（非 h1），以 conceptMeta.a9.titleZh 全文斷言。
    await expect(page.getByText("A9 · 機器人 / 自主巡檢", { exact: true })).toBeVisible();
    await expect(page.getByText("Concept Preview / Roadmap")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/a9-robot-inspection.png`, fullPage: true });

    // Unified concept 頁為 fixture 語意、不打任何 /api；且新殼不掛 SharedStatusProvider
    //（舊殼的 /api/runtime/status 健康輪詢不存在於 unified route）→ 斷言收緊為完全零 /api。
    expect(apiCalls, "unified concept 佔位頁不得呼叫任何 /api（含殼層輪詢——新殼無 SharedStatusProvider）").toEqual([]);
  });

  test("#a10 顯示其他應用／AI 決策 ConceptPage", async ({ page }) => {
    await page.goto("/#a10");
    await expect(page.getByText("A10 · 其他應用 / AI 決策", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOT}/a10-ai-decision.png`, fullPage: true });
  });

  test("ChatUSD 全域右欄（ROADMAP · A10）保留在 legacy 殼（#sessions）", async ({ page }) => {
    // 新殼依設計稿無 agent 欄；ChatUSD 欄＋ROADMAP · A10 掛牌斷言移到 legacy 路由驗證。
    await page.goto("/#sessions");
    await expect(page.getByText("Chat USD Agent")).toBeVisible();
    await expect(page.getByText("ROADMAP · A10")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/chatusd-legacy-sessions.png`, fullPage: true });
  });

  test("#apps 的 A1 卡片導向 #a1（hash 不變；落點＝UnifiedShell workspace dock A1）", async ({ page }) => {
    await page.goto("/#apps");
    await page.screenshot({ path: `${SHOT}/apps-cards.png`, fullPage: true });

    await page.locator(".ec-appcard").filter({ hasText: "BIM 治理與模型檢核" }).first().click();

    await expect(page).toHaveURL(/#a1$/);
    // 落點改驗 workspace：A1 dock（規則集清單 + 執行鈕，initialFlags.a1Ran=true → 重新執行）。
    await expect(page.getByText("A1 治理檢核").first()).toBeVisible(); // dock tab（與 dock 標題同文案）
    await expect(page.getByText("規則集", { exact: true })).toBeVisible();
    await expect(page.getByText("重新執行", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOT}/a1-workspace-after-card-click.png`, fullPage: true });
  });

  test("canonical A4 renders one table-only surface；legacy aliases scrub data；解譯模式 primary 高亮可見", async ({ page }) => {
    await page.goto("/#workspace?dock=a4");
    await expect(page).toHaveURL(/#workspace\?dock=a4$/);
    await expect(page.getByTestId("a4-semantic-search-page")).toBeVisible();
    await expect(page.getByTestId("a4-table-only")).toBeVisible();
    await expect(page.getByTestId("a4-source-path")).toHaveCount(0);
    await expect(page.getByTestId("a4-create-issues")).toHaveCount(0);

    for (const legacyRoute of [
      "/#a4?query=IfcDoor&usd_prim_path=%2FRoot",
      "/#semantic-search?evidence_proof=opaque-proof",
      "/#app/ai-search?ifc_guid=A4-DOOR-001",
    ]) {
      await page.goto(legacyRoute);
      await expect(page).toHaveURL(/#workspace\?dock=a4$/);
      await expect(page.getByTestId("a4-semantic-search-page")).toBeVisible();
    }

    const semantic = page.getByTestId("a4-mode-semantic");
    const deterministic = page.getByTestId("a4-mode-deterministic");

    await semantic.click();
    await expect(semantic).toHaveClass(/\bprimary\b/);
    await expect(deterministic).not.toHaveClass(/\bprimary\b/);
    await page.screenshot({ path: `${SHOT}/a4-canonical-mode-semantic-primary.png`, fullPage: true });

    await deterministic.click();
    await expect(deterministic).toHaveClass(/\bprimary\b/);
    await expect(semantic).not.toHaveClass(/\bprimary\b/);
    await page.screenshot({ path: `${SHOT}/a4-canonical-mode-deterministic-primary.png`, fullPage: true });

    // 回歸防線：click 後滑鼠仍停在按鈕上（hover 態）。`.ec-btn:hover:not(:disabled)` 的特異性
    // (0,3,0) 高於 `.ec-btn.primary` (0,2,0)，會把 color 覆蓋成 --ec-grn——正是 primary 自身的
    // 背景色——使 hover 中的 primary 按鈕文字完全蒸發（A1「執行檢核」等主要 CTA 皆中）。
    // toHaveClass 與 unit test 都抓不到這種失效，只有 browser 的 computed style／截圖看得見。
    const hovered = await deterministic.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor };
    });
    expect(
      hovered.color,
      `primary 按鈕 hover 時文字色不得與背景同色（color=${hovered.color} / bg=${hovered.background}）`,
    ).not.toBe(hovered.background);
    await page.screenshot({ path: `${SHOT}/a4-canonical-mode-primary-hover-readable.png`, fullPage: true });
  });
});
