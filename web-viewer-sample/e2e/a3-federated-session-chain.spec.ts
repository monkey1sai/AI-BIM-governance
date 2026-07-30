import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";
import {
  classifyHarnessUse,
  loadIsolatedStackConfig,
  requireIsolatedEvidenceGeneration,
  requireReal,
  watchForbiddenRequests,
  writeIsolatedEvidenceManifest,
} from "./support/isolated-stack";

// A3 federation→session：manifest-owned viewer 的 #/federation 以兩個真 USD
// fixtures 建 federated set、驗證、build、review-room，最後建立 Review Session。
const isolated = loadIsolatedStackConfig();
const COORDINATOR = isolated?.coordinatorBaseUrl ?? "";
const A3_USD_DIR = isolated ? path.join(isolated.readOnlyFixtureRoot, "e2e-a3") : "";
const ARCH_USD = path.join(A3_USD_DIR, "arch.usdc");
const STR_USD = path.join(A3_USD_DIR, "str.usdc");

// member usd_path input 的 zh placeholder（pages.tsx:1560；fresh context 無 localStorage → i18n 預設 zh）。
const USD_PLACEHOLDER = "member .usd / .usdc 路徑（conversion 產出）";

function requireContainedRegularFixture(candidate: string, label: string): void {
  requireReal(existsSync(candidate), `A3 ${label} USD fixture is required and must exist`);
  const physicalRoot = realpathSync(isolated!.readOnlyFixtureRoot);
  const physicalCandidate = realpathSync(candidate);
  const relative = path.relative(physicalRoot, physicalCandidate);
  requireReal(
    relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    `A3 ${label} USD fixture must stay inside the manifest read-only fixture root`,
  );
  requireReal(statSync(physicalCandidate).isFile(), `A3 ${label} USD fixture must be a regular file`);
}

async function cleanupCreatedSession(request: APIRequestContext, sessionId: string): Promise<void> {
  try {
    const response = await request.post(
      `${COORDINATOR}/api/review-sessions/${encodeURIComponent(sessionId)}/close`,
      { data: { reason: "e2e a3-federated-session-chain cleanup" }, timeout: 15_000 },
    );
    if (!response.ok()) {
      console.log(`[a3-e2e] cleanup session=${sessionId}: HTTP ${response.status()} (manual cleanup required)`);
    }
  } catch {
    console.log(`[a3-e2e] cleanup session=${sessionId}: manual cleanup required`);
  }
}

test.describe("A3 federation→session 一鍵鏈（#/federation 真 backend 全鏈）", () => {
  test.skip(!isolated, "A3 isolated evidence requires E2E_REQUIRE_REAL=1");
  if (!isolated) return;
  // 預算：守門 ~30s + prepare 30s + build 60s + review-room 30s + create session 60s + 截圖 → 240s 上限。
  test.setTimeout(240_000);

  // afterEach 誠實清理只關「本測建立」的 session：test body 拿到 session_id 才填入；其他 session 一律不碰。
  let createdSessionId: string | null = null;
  let forbiddenGuard: ReturnType<typeof watchForbiddenRequests> | undefined;
  let createdSetId: string | null = null;
  let tracePath = "";
  let traceActive = false;
  let completed = false;

  test.beforeEach(async ({ request, page }, testInfo) => {
    createdSessionId = null;
    createdSetId = null;
    completed = false;
    forbiddenGuard = watchForbiddenRequests(page, isolated.coordinatorBaseUrl);
    tracePath = testInfo.outputPath("a3-federated-session-chain-trace.zip");
    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceActive = true;
    requireContainedRegularFixture(ARCH_USD, "ARCH");
    requireContainedRegularFixture(STR_USD, "STR");

    const health = await request.get(`${COORDINATOR}/health`, { timeout: 10_000 });
    requireReal(health.ok(), `isolated coordinator health failed: HTTP ${health.status()}`);

    // Read-only coordinator→governance proxy probe; it must not create a set.
    const probe = await request.get(`${COORDINATOR}/api/governance/search/llm-status`, { timeout: 10_000 });
    requireReal(probe.ok(), `isolated governance proxy probe failed: HTTP ${probe.status()}`);
    const probeBody = await probe.json() as unknown;
    requireReal(typeof probeBody === "object" && probeBody !== null && !Array.isArray(probeBody), "isolated governance proxy probe returned invalid JSON");

    await page.goto("/#/federation");
    await page.getByPlaceholder(USD_PLACEHOLDER).first().waitFor({ state: "visible", timeout: 15_000 });
  });

  test.afterEach(async ({ request, page }, testInfo) => {
    try {
      let screenshotPath: string | null = null;
      if (completed && createdSetId && createdSessionId) {
        screenshotPath = testInfo.outputPath("a3-federated-session-chain.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });
      }
      if (traceActive) { await page.context().tracing.stop({ path: tracePath }); traceActive = false; }
      forbiddenGuard?.assertClean();
      if (completed && createdSetId && createdSessionId && screenshotPath) {
        await writeIsolatedEvidenceManifest(isolated, {
          invocationGeneration: requireIsolatedEvidenceGeneration(testInfo.config.metadata),
          testId: "a3-federated-session-chain",
          route: "#/federation",
          mainButtons: ["準備 + 驗證坐標系", "Build Federated USD", "Open in Review Room", "a3-create-session"],
          fixture: "ARCH/STR real USD fixtures",
          backendApi: "GET /api/governance/search/llm-status; federation and review-session proxy flow",
          observedRuntimeIds: { set_id: createdSetId, session_id: createdSessionId },
          visibleStates: ["coordinate-consistent", "review-room-ready", "session-created"],
          screenshotPaths: [screenshotPath], tracePath,
          harness: classifyHarnessUse({ buildFlag: isolated.harnessBuildFlag, queryFlag: new URL(page.url()).searchParams.get("harness") === "1" }),
        });
      }
    } finally {
      if (traceActive) { await page.context().tracing.stop({ path: tracePath }); traceActive = false; }
      // 只關本測已確認建立的 session；絕不枚舉或關閉其他 session。
      const sid = createdSessionId;
      createdSessionId = null;
      if (sid) {
        await cleanupCreatedSession(request, sid);
      }
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
        expect(false, `${what}：後端顯示錯誤狀態`).toBe(true);
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
    await usdInputs.nth(0).fill(ARCH_USD);
    await usdInputs.nth(1).fill(STR_USD);
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

    // set_id（UI 可見形）：session model_version_id 輸入的 placeholder=federated_<set_id>（pages.tsx:1623）。
    const mvInput = page.locator('input[placeholder^="federated_"]');
    const setId = ((await mvInput.getAttribute("placeholder")) ?? "").replace(/^federated_/, "");
    expect(setId, "session 區塊 placeholder 應帶真實 set_id").not.toBe("");
    createdSetId = setId;
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
    expect(scPrimaryUrl.endsWith("federated_review.usda"), "stream-config primary 必須是 federated_review.usda").toBe(true);
    expect(scPrimaryUrl).not.toContain("[server-path]");

    completed = true;
  });
});
