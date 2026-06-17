import { test, expect } from "@playwright/test";

// IX-SS-04 #sessions「結束 session」controlled action 端到端（重用 close 路由）：
// 對 live 測試區實際存在的 active session 驗 browser 切片：列出現「結束 session」鈕 ->
//   點按開 IntentDialog -> 確認 -> 觀察一次真後端回應（POST .../close 2xx + runtime/status
//   重抓該 session active->closed + 該列轉灰）。誠實鐵律：無樂觀更新、非 active 不給假按鈕、
//   未觀察轉移以 notObserved 原文揭露、不偽造；深度因果由 sessions.test.ts route 測試兜底。
//
// 測試區常態無 active session -> beforeEach 先 POST /api/review-sessions 種一個真 session
//   （綁最小 artifact_bindings，沿用既有 fixture 風格）再驗結束切片。每輪重置 seededId，
//   避免（未來若加第二個 test 或開 retries）沿用上一輪已 close 的 stale id。
//
// skip-gate 效力限制（比照 conv-prioritize-retry.spec.ts）：守門是 conditional skip（coordinator
//   不可達 -> skip -> 計 pass，非 fail）。本 repo .github/workflows 無 Playwright job，故不 false-green
//   任何既有 CI gate；純本機 / 指揮官手動 P4 gate。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";

test.describe("IX-SS-04 #sessions 結束 session controlled action", () => {
  test.setTimeout(120_000);
  let seededId: string | null = null;
  let coordinatorUp = false;
  const notObserved: string[] = [];

  test.beforeEach(async ({ request }) => {
    seededId = null;
    coordinatorUp = false;
    // 區分兩種失敗：網路層不可達（fetch throw / 非 2xx）→ 留 coordinatorUp=false → 下方 conditional skip；
    //   但「回 2xx 卻缺 string session_id」是回應契約破壞，必須 fail（而非被 catch 吞成 skip 掩蓋 regression）。
    //   故把契約違規記在 contractError，跳出 try/catch 後再 throw，避免被「不可達→skip」的 catch 吃掉。
    let contractError: Error | null = null;
    try {
      const created = await request.post(`${COORDINATOR}/api/review-sessions`, {
        data: { project_id: "271", model_version_id: "mv_e2e_terminate", artifact_bindings: [] },
      });
      if (created.ok()) {
        coordinatorUp = true;
        const parsed = (await created.json()) as { session_id?: unknown };
        if (typeof parsed.session_id !== "string" || parsed.session_id.length === 0) {
          contractError = new Error(`POST /api/review-sessions 回 2xx 但缺 string session_id（回應契約破壞）：${JSON.stringify(parsed)}`);
        } else {
          seededId = parsed.session_id;
        }
      }
    } catch { coordinatorUp = false; }
    if (contractError) throw contractError;
    if (!coordinatorUp || !seededId) {
      notObserved.push("coordinator :8005 不可達或種 session 失敗；按鈕 -> IntentDialog -> 真 POST .../close -> 列轉灰 這條 browser 切片本輪 not observed，深度因果由 sessions.test.ts 兜底。");
    }
    test.skip(!coordinatorUp || !seededId, "需 branch coordinator :8005 可達且能 POST /api/review-sessions 種 session；見檔頭前置。深度因果由 sessions.test.ts 兜底。");
  });

  test("結束鈕 -> IntentDialog -> 真 POST .../close -> runtime/status active->closed + 列轉灰", async ({ page }) => {
    const id = seededId!;
    await page.goto(`/#sessions`);
    // 明確 data-testid 選取刷新鈕（pages.tsx「重新整理」Btn 帶 data-testid="sessions-refresh"）：
    //   此頁刷新鈕為靜態文字、無 loading 態，原 getByRole(name:/重新整理|讀取中/).first() 的「讀取中」
    //   半邊永不匹配，且 .first() 在日後新增同文字鈕時會靜默點錯列；testid 唯一選取消除模糊性。
    await page.locator('[data-testid="sessions-refresh"]').click();
    const btn = page.locator(`[data-testid="session-terminate-${id}"]`);
    await btn.waitFor({ state: "visible", timeout: 30_000 });
    await btn.click();
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeVisible({ timeout: 30_000 });
    const [postResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/review-sessions/${id}/close`) && r.request().method() === "POST", { timeout: 30_000 }),
      page.locator('[data-testid="intent-confirm"]').click(),
    ]);
    expect(postResponse.status(), "POST .../close 應回 2xx").toBeGreaterThanOrEqual(200);
    expect(postResponse.status()).toBeLessThan(300);
    // 證據型更新：dialog 關閉 + 該列轉灰（ec-row-muted）+ runtime/status 真值該 session active->closed。
    await expect(page.locator('[data-testid="intent-dialog"]')).toBeHidden({ timeout: 30_000 });
    // 列轉灰 browser 切片（task 觀察目標 / 本 PR「Browser E2E = user-facing 唯一接受證據」核心守門）：
    //   confirm 後 markTerminating 立即加灰、或 load() 重抓 runtime/status 後該列 status=closing/closed
    //   而 greyed=true（pages.tsx：greyed = terminating || ended）；markTerminating(id) 在 load() 前
    //   同步觸發（pages.tsx:729）。spec §6.4 接受兩種合法終局：列轉灰，或後端釋放後該列被 load() 從
    //   DOM 移除（runtime/status 不再 emit 該 id）。
    // 真 gate（不再用舊版 toHaveClass(...).catch() 把任何失敗吞進 notObserved，避免 markTerminating
    //   灰列邏輯退化 / ec-row-muted 根本沒加也被吞掉，喪失守門力）：confirm 後等一下，先用 count()
    //   判斷該列是否仍在 DOM —— 區分兩條路徑：
    //   (a) 列已不在 DOM（count()==0，後端移除/過濾，spec §6.4 接受的「移除」結局）→ 合法，push
    //       notObserved 並註明 row removed from DOM (backend-driven removal)，不視為失敗。
    //   (b) 列【仍在 DOM 但缺 ec-row-muted class】→ 這是 markTerminating 真退化，硬斷言 FAIL
    //       （expect(rowAfter).toHaveClass(/ec-row-muted/) 不加 .catch，不准吞進 notObserved）。
    const rowAfter = page.locator(`[data-testid="session-row-${id}"]`);
    // 等一下讓 markTerminating + load() 重抓完成（任一條件穩定後 count() 才有意義）；用條件等待而非裸 sleep：
    //   要嘛列已轉灰（仍在 DOM），要嘛列已從 DOM 移除（count()==0），兩者皆是 spec §6.4 合法終局之一。
    try {
      await expect
        .poll(async () => (await rowAfter.count()) === 0 || (await rowAfter.getAttribute("class") ?? "").includes("ec-row-muted"), { timeout: 5_000 })
        .toBe(true);
    } catch { /* 逾時不在此判定：交給下方 count() 分流，列在但非灰會走 (b) 硬失敗。明確 try/catch，不依賴 Playwright 內部 .catch() shim */ }
    if ((await rowAfter.count()) === 0) {
      // (a) 後端釋放後該列已被 load() 從 DOM 移除（runtime/status 不再 emit ${id}），spec §6.4 接受的「移除」結局。
      notObserved.push(`#sessions 列轉灰切片本輪以「移除」結局收尾：row removed from DOM (backend-driven removal)；後端釋放後 runtime/status 不再 emit ${id}，故 load() 後該列離開 DOM（spec §6.4 接受），列轉灰 className 本輪 not observed，深度因果由 sessions.test.ts 兜底。`);
    } else {
      // (b) 列仍在 DOM —— 必須是灰列；缺 ec-row-muted 即 markTerminating 退化，硬失敗（不吞 notObserved）。
      await expect(rowAfter).toHaveClass(/ec-row-muted/);
    }
    const after = await page.request.get(`${COORDINATOR}/api/runtime/status`);
    // 顯式驗 2xx 再解析：若 coordinator 在 POST close 後短暫過載 / 回 5xx，after.json() 可能 throw
    //   或回 error body，afterBody.sessions?.items 變 undefined → refreshed undefined → 靜默落
    //   notObserved，掩蓋真後端問題並讓「active->closed 狀態遷移」核心斷言失效。改為硬斷言，讓失敗顯式。
    expect(after.ok(), `runtime/status 應可達（got ${after.status()}）`).toBeTruthy();
    const afterBody = await after.json();
    const refreshed = (afterBody.sessions?.items ?? []).find((s: { session_id: string }) => s.session_id === id);
    // 後端釋放後該 session 可能 status=closed 仍在列、或已移出 items（兩者皆真，誠實揭露）。
    if (refreshed) {
      expect(["closing", "closed"]).toContain(refreshed.status);
    } else {
      notObserved.push(`runtime/status 已不再 emit ${id}（後端釋放後移出 items）；以 POST 2xx 為終結證據。`);
    }
    await page.screenshot({ path: `../artifacts/e2e/sessions-terminate-slice.png`, fullPage: true });
  });

  test.afterAll(() => {
    if (notObserved.length) console.log("[sessions-terminate] notObserved:", JSON.stringify(notObserved));
  });
});

// render-surface 證據（不受上方守門）：無條件渲染 #sessions 真頁面 + 截圖落 tracked evidence。
// 誠實鐵律：此截圖只證明 #sessions 真頁面渲染 + 截圖機制可落點，不等於觀察到 controlled action；
// 該深度切片由上方 slice test（前置齊全才跑）與 sessions.test.ts route 測試兜底。
test.describe("sessions-terminate render-surface 證據（非 controlled-action 觀察）", () => {
  test.setTimeout(60_000);
  test("渲染 #sessions 真頁面 -> 截圖 render surface（evidence）", async ({ page }) => {
    await page.goto(`/#sessions`);
    await expect(page.getByText("Session 管理", { exact: false })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "../docs/evidence/sessions-terminate/sessions-render-surface.png", fullPage: true });
    await page.screenshot({ path: "../artifacts/e2e/sessions-terminate-render-surface.png", fullPage: true });
  });
});
