import { test, expect, type Locator } from "@playwright/test";

// A3 federation→session 一鍵鏈端到端：#/federation 以真 USD fixtures 建 federated set + 2 members →
// validate-coords 一致 → Build federated_review.usda → review-room descriptor ready →
// 「建立 Review Session（federated stage）」→ 斷言 session_id / a3-open-viewer href / spectator URL。
//
// *** 服務這頁的是 COORDINATOR 已 build 的 dist-ui（npm run build:ui → dist-ui），
//     不是 playwright.config.ts 的 fresh viewer（:5180）。前置（乾淨環境必做）：
//       1. cd web-viewer-sample && npm run build:ui   # 用本 branch 的碼重 build dist-ui
//       2. 啟動 branch coordinator（預設 :8005）服務新 dist-ui；GOVERNANCE_API_BASE 指向
//          branch governance（:49103，BIM_FILE_LIBRARY_ROOT=主 worktree storage）。
//       3. 真 USD fixtures：{A3_USD_DIR}/arch.usdc + str.usdc（Z-up、metersPerUnit=1、World defaultPrim）。
//          預設 C:/Repos/active/iot/AI-BIM-governance/storage/e2e-a3；用 E2E_A3_USD_DIR 覆寫。
//       4. coordinator 跑別的 port 用 E2E_COORDINATOR_BASE_URL 覆寫。
//     跑法（全絕對 COORDINATOR URL，比照 a1-m1 模式，不需 config webServer）：
//       E2E_DISABLE_WEBSERVER=1 npx playwright test e2e/a3-federated-session-chain.spec.ts
//
// *** skip-gate 效力限制（誠實揭露，比照 a1-m1-closeout / a2-version-diff-selector）：
//     beforeEach 三道是 conditional skip（前置缺失 → skip，Playwright 計 skipped ≠ PASS 斷言）。
//     本 repo .github/workflows 僅 pr-review-agent.yml、無 Playwright job，故 skip 不會 false-green
//     任何既有自動化 gate；此 spec 純屬本機/指揮官手動 P4 硬 gate。判讀鐵證：真 PASS 必產出
//     artifacts/e2e/a3-federated-session-chain.png；走 skip 不會有這張截圖。
//
// *** UI 現況 vs 任務期望的誠實差異（以 pages.tsx FederationPage 為準；spec 適應元件、不改元件）：
//     - set 名稱：prepare 寫死 createFederatedSet("coord-meeting")（pages.tsx:1461），UI 無名稱輸入
//       → 無法「set 名稱帶時戳」；唯一性由後端產生的 set_id 保證（時戳名只用在守門 (c) 的 probe set）。
//     - member model_version_id：UI 無 per-member 輸入欄（元件預設 arc_v1 / str_v1，pages.tsx:1428-1429，
//       兩值相異、隨 addFederatedMember 真實送後端）→「各填」由預設值滿足，不假裝可編輯。
//     - member_id：後端有回（addFederatedMember → {member_id}）但 UI 不顯示 → runtime IDs 只印 UI 可見的
//       set_id（session model_version_id 輸入的 placeholder=federated_<set_id>，pages.tsx:1623）與 session_id。
//     - a3-create-session / a3-session-result / a3-open-viewer / a3-invite-spectator 都在 {room && …} 區塊內
//       （review-room descriptor 取得後才 render）→ 初載頁面拿不到任何 a3-* testid，branch-gate 改成雙重驗證：
//       (i) dist-ui bundle 內含 "a3-create-session" 字串（data-testid 是 build-time string literal，minify 不動）、
//       (ii) #/federation 真的 render（member usd_path input 可見）。
//     - server path 遮蔽（實測 2026-07-15，coordinator governanceProxy.ts redactServerPaths:82-86,145）：
//       /api/governance/* proxy 回應中的絕對路徑一律換成 "[server-path]"（防洩漏，coordinator 測試
//       governance-rule-run-for-session.test.ts:600 明文斷言此行為）→ 瀏覽器看到的 build.usda_path 與
//       review-room stage_composition.primary.url 都是字面 "[server-path]"。故 usda 斷言接受
//       「真 .usda 路徑（未遮蔽部署）或 [server-path]（遮蔽後的誠實顯示）」；build 真實成功的硬證改由
//       member 數=2 + hidden members Field + review-room ready:true 承擔。已知產品缺口（本 spec 如實
//       記錄、不掩蓋）：UI 建 session 時 artifact_binding.url 帶的就是這個遮蔽字串（pages.tsx:1510/1535，
//       coordinator createSessionSchema url 欄位 passthrough 接受），session 建立會成功、但該 binding
//       無法供 Kit 解析真實 federated_review.usda —— 屬元件×proxy 互動缺口，於測試報告回報，非 spec 誤解。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const A3_USD_DIR = process.env.E2E_A3_USD_DIR || "C:/Repos/active/iot/AI-BIM-governance/storage/e2e-a3";

// member usd_path input 的 zh placeholder（pages.tsx:1560；fresh context 無 localStorage → i18n 預設 zh）。
const USD_PLACEHOLDER = "member .usd / .usdc 路徑（conversion 產出）";

test.describe("A3 federation→session 一鍵鏈（#/federation 真 backend 全鏈）", () => {
  // 預算：守門 ~30s + prepare 30s + build 60s + review-room 30s + create session 60s + 截圖 → 240s 上限。
  test.setTimeout(240_000);

  // afterEach 誠實清理只關「本測建立」的 session：test body 拿到 session_id 才填入；其他 session 一律不碰。
  let createdSessionId: string | null = null;

  test.beforeEach(async ({ request, page }) => {
    // 守門 (a)：coordinator /health 可達。explicit 10s timeout（fail-fast，不讓慢後端吃整體預算；對齊 a1 慣例）。
    let healthOk = false;
    try {
      const res = await request.get(`${COORDINATOR}/health`, { timeout: 10_000 });
      healthOk = res.ok();
    } catch {
      healthOk = false;
    }
    test.skip(!healthOk, `coordinator 未備妥（${COORDINATOR}/health 不可達）`);

    // 守門 (c)：governance 經 coordinator proxy 可達 —— 真打 POST /api/governance/federated-sets。
    // probe set 名稱帶時戳避免重複；federated set 是 metadata-only（不 build、不開 session），殘留無害。
    let govOk = false;
    try {
      const res = await request.post(`${COORDINATOR}/api/governance/federated-sets`, {
        data: { name: `e2e_a3_gate_${Date.now()}` },
        timeout: 10_000,
      });
      if (res.ok()) {
        const body = (await res.json()) as { set_id?: unknown };
        govOk = typeof body.set_id === "string" && body.set_id.length > 0;
      }
    } catch {
      govOk = false;
    }
    test.skip(
      !govOk,
      "governance 經 proxy 不可達（POST /api/governance/federated-sets 失敗）：需 branch governance(:49103) + coordinator GOVERNANCE_API_BASE 指向它。",
    );

    // 守門 (b)：branch dist-ui 已部署（bundle 含 a3-create-session）且 #/federation 真的 render。
    // 見檔頭「誠實差異」末條：a3-* testid 初載不可見 → bundle 字串驗 branch、usd_path input 驗頁面。
    let uiOk = false;
    try {
      const html = await (await request.get(`${COORDINATOR}/ui/`, { timeout: 10_000 })).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
      let bundleHasA3 = false;
      for (const asset of assets) {
        const url = asset.startsWith("http")
          ? asset
          : `${COORDINATOR}${asset.startsWith("/") ? "" : "/"}${asset}`;
        const js = await (await request.get(url, { timeout: 15_000 })).text();
        if (js.includes("a3-create-session")) {
          bundleHasA3 = true;
          break;
        }
      }
      if (bundleHasA3) {
        // 此導航同時是 test body 的唯一導航（成功後 page 停在 #/federation、member rows 已 render），
        // test body 直接複用、不重複 goto（重複導航會 unmount/remount，比照 a2 的理由）。
        await page.goto(`${COORDINATOR}/ui/#/federation`);
        await page.getByPlaceholder(USD_PLACEHOLDER).first().waitFor({ state: "visible", timeout: 15_000 });
        uiOk = true;
      }
    } catch {
      uiOk = false;
    }
    test.skip(
      !uiOk,
      "coordinator dist-ui 非本 branch 或 #/federation 未 render（bundle 缺 a3-create-session / member usd_path input 未見）：需 npm run build:ui 後重啟 coordinator（見檔頭前置）。",
    );
  });

  test.afterEach(async ({ request }) => {
    // 誠實清理：只關本測建立的那顆 session（POST /api/review-sessions/:id/close）。
    // UI 無 close 鈕（SS 頁才有）→ 直接 fetch。失敗不吞：印出真實狀態供人工收尾。
    if (!createdSessionId) return;
    const sid = createdSessionId;
    createdSessionId = null;
    try {
      const res = await request.post(
        `${COORDINATOR}/api/review-sessions/${encodeURIComponent(sid)}/close`,
        { data: { reason: "e2e a3-federated-session-chain cleanup" }, timeout: 15_000 },
      );
      console.log(`[a3-e2e] cleanup: close ${sid} → HTTP ${res.status()}`);
    } catch (e) {
      console.log(`[a3-e2e] cleanup: close ${sid} 失敗（需人工收尾）：${String(e)}`);
    }
  });

  test("#/federation 建 set+2 members → validate 一致 → build usda → review-room ready → 建立 review session → viewer/spectator 連結", async ({ page }) => {
    // FederationPage 各步失敗都以 ec-warn-note 誠實顯示（err / room.note / sessErr）。
    // 等待目標元素時 race 這個訊號：錯誤先到就用真實文字炸出（指向根因，不留誤導 timeout；比照 a2 race 診斷模式）。
    const warnNote = page.locator("main .ec-warn-note");
    const waitOrExplain = async (target: Locator, what: string, timeout: number) => {
      const outcome = await Promise.race([
        target.waitFor({ state: "visible", timeout }).then(() => "ok" as const, () => "timeout" as const),
        warnNote.first().waitFor({ state: "visible", timeout }).then(() => "err" as const, () => "timeout" as const),
      ]);
      if (outcome === "err") {
        const detail = (await warnNote.first().innerText()).slice(0, 400);
        expect(false, `${what}：後端誠實回報錯誤 → ${detail}`).toBe(true);
      }
      expect(outcome, `${what} 未在 ${timeout / 1000}s 內出現（目標元素與錯誤訊息皆未見）`).toBe("ok");
    };

    // beforeEach 已導航到 #/federation 且 member rows 可見；直接複用（不重複 goto）。
    const usdInputs = page.getByPlaceholder(USD_PLACEHOLDER);
    await expect(usdInputs).toHaveCount(2); // 元件固定 2 個 member row（ARC/STR 預設）

    // member row DOM =（discipline input）（usd input）（layer_order input）（visible checkbox）（offset x3）
    // —— pages.tsx:1558-1571，member 欄位無 testid → 以 usd placeholder 定 row、xpath=.. 取 parent。
    const row = (i: number) => usdInputs.nth(i).locator("xpath=..");
    // discipline：真的打字改成 ARCH / STR（任務指定；欄位可編輯，root_prim=/World/<discipline> 只影響
    // transform/visibility overs，本測全 visible 且零位移 → 不影響 build）。
    await row(0).locator("input").nth(0).fill("ARCH");
    await row(1).locator("input").nth(0).fill("STR");
    // usd_path：真 USD fixtures（governance 端讀檔驗證，路徑不存在 → prepare 會誠實失敗）。
    await usdInputs.nth(0).fill(`${A3_USD_DIR}/arch.usdc`);
    await usdInputs.nth(1).fill(`${A3_USD_DIR}/str.usdc`);
    // layer_order 0/1（小=強；title 屬性是唯一穩定 handle）。
    const layerInputs = page.getByTitle("layer_order（小=強）");
    await layerInputs.nth(0).fill("0");
    await layerInputs.nth(1).fill("1");

    // Step 1：準備 + 驗證坐標系（一鍵 = create set + 2×members + validate-coords，pages.tsx prepare()）。
    await page.getByRole("button", { name: /準備 \+ 驗證坐標系/ }).click();
    // consistent 斷言：Field「共享坐標系驗證」出現後必須含「一致 ✓」。
    // inconsistent 分支渲染「不一致：<issues>」（無 ✓）→ hasText "一致 ✓" 不會被「不一致」子字串誤中；
    // toContainText 失敗時會把實際文字（含 issues）印進錯誤，直接指向坐標系問題。
    const coordField = page.locator("main .ec-field", { hasText: "共享坐標系驗證" });
    await waitOrExplain(coordField, "validate-coords 結果（共享坐標系驗證 Field）", 30_000);
    await expect(coordField, "共享坐標系驗證必須為一致").toContainText("一致 ✓");

    // Step 2：Build Federated USD → 斷言 build 結果 render（usda_path Field + member 數=2 + hidden members）。
    // usda_path 經 proxy 遮蔽顯示為 "[server-path]"（見檔頭「server path 遮蔽」條）→ 接受兩種誠實值。
    await page.getByRole("button", { name: /Build Federated USD/ }).click();
    const usdaField = page.locator("main .ec-field", { hasText: "federated_review.usda" });
    await waitOrExplain(usdaField, "build 產出（federated_review.usda Field）", 60_000);
    const usdaPathText = (await usdaField.locator(".ec-v").innerText()).trim();
    expect(usdaPathText, "usda_path 應為真實路徑或 proxy 遮蔽形 [server-path]").toMatch(/\.usda|\[server-path\]/);
    await expect(page.locator("main .ec-field", { hasText: "member 數" }).locator(".ec-v")).toContainText("2");
    // 全 visible（本測不勾 hidden）→ hidden members Field 誠實顯示「（無，全部 visible）」。
    await expect(page.locator("main .ec-field", { hasText: "hidden members" })).toContainText("無，全部 visible");

    // Step 3：Open in Review Room → descriptor ready 斷言 = stage_composition.primary Field 出現
    //（僅 room.ready && stage_composition 時 render，pages.tsx:1604-1608；not-ready 分支只有 warn-note → race 抓）。
    await page.getByRole("button", { name: /Open in Review Room/ }).click();
    const primaryField = page.locator("main .ec-field", { hasText: "stage_composition.primary" });
    await waitOrExplain(primaryField, "review-room descriptor ready（stage_composition.primary Field）", 30_000);
    const primaryUrl = (await primaryField.locator(".ec-v").innerText()).trim().split(/\s+/)[0] ?? "";

    // set_id（UI 可見形）：session model_version_id 輸入的 placeholder=federated_<set_id>（pages.tsx:1623）。
    const mvInput = page.locator('input[placeholder^="federated_"]');
    const setId = ((await mvInput.getAttribute("placeholder")) ?? "").replace(/^federated_/, "");
    expect(setId, "session 區塊 placeholder 應帶真實 set_id").not.toBe("");
    // model_version_id 留空 → 送出 federated_<set_id>（真實對應後端 set）；project_id 用元件預設 federation-demo。

    // Step 4：建立 Review Session（federated stage）。先斷言 enabled（descriptor ready + 必填齊 →
    // createSessionDisabledReason===""）；disabled 時 caption 會帶不可按理由，直接炸 enabled 斷言即指向該 gate。
    const createBtn = page.getByTestId("a3-create-session");
    await expect(createBtn, "a3-create-session 應 enabled（descriptor ready + project/model_version 必填齊）").toBeEnabled({ timeout: 10_000 });
    await createBtn.click();

    // session_id 斷言：a3-session-result 內 Field k="session_id"。失敗分支（400 schema / 409 無 Kit 容量）
    // 渲染 warn-note「建立失敗（後端誠實回應）：…」→ waitOrExplain 會用真實 detail 炸出。
    const result = page.getByTestId("a3-session-result");
    const sessField = result.locator(".ec-field", { hasText: "session_id" });
    await waitOrExplain(sessField, "review session 建立（session_id Field）", 60_000);
    // .ec-v = "<session_id> <ProvTag 文字>" → 取第一個 whitespace token 做全錨點格式斷言
    //（真實格式：sessionStore.ts:41 `review_session_${uuid-hex12}` → ^review_session_[a-z0-9]+$）。
    const sessionId = (await sessField.locator(".ec-v").innerText()).trim().split(/\s+/)[0] ?? "";
    expect(sessionId).toMatch(/^review_session_[a-z0-9]+$/);
    createdSessionId = sessionId; // afterEach 只關這顆（誠實清理範圍）

    // a3-open-viewer：href 必須指向 coordinator /ui/open?session=<本 session>。
    const openViewer = page.getByTestId("a3-open-viewer");
    await expect(openViewer).toBeVisible();
    const href = (await openViewer.getAttribute("href")) ?? "";
    expect(href).toContain("/ui/open?session=");
    expect(href).toContain(sessionId);

    // a3-invite-spectator：Btn caption（ec-cap span）顯示完整 spectator URL（…&streamRole=spectator）。
    const spectatorBtn = page.getByTestId("a3-invite-spectator");
    await expect(spectatorBtn).toBeVisible();
    await expect(spectatorBtn).toContainText("/ui/open?session=");
    await expect(spectatorBtn).toContainText("streamRole=spectator");
    await expect(spectatorBtn).toContainText(sessionId);
    // 同一 URL 也以文字顯示於 ec-note <code>（clipboard 不可用時的誠實 fallback，pages.tsx:1663）。
    const spectatorUrl = (await result.locator("code").innerText()).trim();
    expect(spectatorUrl).toContain(`session=${sessionId}`);
    expect(spectatorUrl).toContain("streamRole=spectator");

    // Kit 可載性硬證（A3-G1b 修復）：瀏覽器只送 federated_set_id，coordinator server-side
    // 解析真 stage——stream-config 的 stage_composition.primary.url 必須是真 federated_review.usda
    //（先前前端自組被 proxy 遮蔽的 "[server-path]" 時，此處會是遮蔽字面、Kit 載入必失敗）。
    const streamConfig = await (await page.request.get(
      `${COORDINATOR}/api/review-sessions/${sessionId}/stream-config`,
    )).json() as { stage_composition?: { primary?: { url?: string } } };
    const scPrimaryUrl = streamConfig.stage_composition?.primary?.url ?? "";
    expect(scPrimaryUrl.endsWith("federated_review.usda"), `stream-config primary=${scPrimaryUrl}`).toBe(true);
    expect(scPrimaryUrl).not.toContain("[server-path]");
    console.log(`[a3-chain] stream-config primary url=${scPrimaryUrl}`);

    await page.screenshot({ path: "../artifacts/e2e/a3-federated-session-chain.png", fullPage: true });

    // runtime IDs（UI 可見者如實印出；member_id UI 不顯示 → 誠實不捏造）。
    console.log(`[a3-e2e] runtime IDs：set_id=${setId} session_id=${sessionId}（member_id UI 不顯示，略）`);
    console.log(`[a3-e2e] stage_composition.primary=${primaryUrl}`);
    console.log(`[a3-e2e] usda_path=${usdaPathText}`);
    console.log(`[a3-e2e] open-viewer href=${href}`);
    console.log(`[a3-e2e] spectator URL=${spectatorUrl}`);
  });
});
