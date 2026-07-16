import { test, expect } from "@playwright/test";
import path from "node:path";

// VG-01（IA v2 / A1 inline 閉環）：#a1-workbench 選 review session → A1 inline 3D pane
//（ReviewSessionViewerPane mode="a1-inline"）手動啟動 viewer lease → first frame / stage matched 證據
// → for-session rule-run → a1-inline-highlight 高亮 ack（或 a1-inline-highlight-reason 誠實 disabled 理由）
// → iframe 截圖到 ../artifacts/e2e/。
//
// *** cross-build-target 前置（乾淨環境必做，否則「改了沒效」假象）：
//     1. cd web-viewer-sample && npm run build:ui
//     2. 重啟 branch coordinator(:8005) 服務新的 dist-ui，且 VIEWER_PUBLIC_BASE_URL 指到 Playwright fresh viewer(:5180)。
//     3. Playwright 會用本 branch 最新碼啟 viewer dev server(:5180)。
//     4. conversion authority(:49101) 需已有 succeeded conversion；本 spec 每個 test 會自建 / 關閉 session。
//     未重建 console 或 viewer 任一 target → 本 spec 觀察到的可能是陳舊碼，不算驗證。
//
// *** skip-gate 效力限制（誠實揭露，比照 a1-m1-closeout.spec.ts）：
//     beforeEach 只對「前置不存在」做 conditional skip（branch coordinator 不通、無 :49101 succeeded conversion、
//     dist-ui 缺本 branch testid、無真 Kit 可掛 viewer 時 first frame 斷言會 timeout 而非假綠）。
//     Playwright 會把 skip 計入非失敗結果，但 skip != PASS。
//     真 PASS 必須看到 first frame observed / stage matched / highlight ack（或誠實 disabled 理由），並落截圖。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const CONVERSION_API = process.env.E2E_CONVERSION_API_BASE || "http://127.0.0.1:49101";
const VG01_IDS_PATH = process.env.E2E_A1_IDS_PATH || path.resolve("..", "governance-service", "rules", "vg01-highlight-column.ids");

type ConversionItem = {
  conversion_job_id?: string;
  project_id?: string;
  model_version_id?: string;
  status?: string;
  ready?: boolean;
  usdc_url?: string;
  mapping_url?: string;
  artifact_group_id?: string;
  model?: { url?: string };
  artifacts?: {
    model_usdc?: { artifact_id?: string; url?: string };
    element_mapping?: { url?: string };
  };
};

function loopbackArtifactUrl(raw: string): string {
  const url = new URL(raw);
  // coordinator path-traversal guard 對非 loopback host 的 artifact url 會拒；conversion artifact 在本機，
  // 一律把非 loopback hostname 正規化到 127.0.0.1（不限 port 49101，涵蓋 LAN IP / host.docker.internal）。
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") url.hostname = "127.0.0.1";
  return url.toString();
}

test.describe("VG-01：#a1-workbench inline viewer + 3D 高亮閉環", () => {
  test.setTimeout(360_000);

  let sessionId = "";

  test.beforeEach(async ({ request, page }) => {
    let apiOk = false;
    try {
      const health = await request.get(`${COORDINATOR}/health`, { timeout: 10_000 });
      apiOk = health.ok();
    } catch {
      apiOk = false;
    }
    test.skip(!apiOk, "branch coordinator 未備妥：需啟動 :8005 或設定 E2E_COORDINATOR_BASE_URL");

    sessionId = "";
    // 注意：刻意「不」盲目關閉 runtime/status 上所有 active/created session。
    // runtime/status 的 session summary 不帶 created_by（無法分辨哪些是本 spec 擁有的），盲關會在共享環境
    // 誤殺其他套件/操作員的 session（跨套件干擾 / 資料遺失）。本 spec 只建立自己的 session（created_by:"playwright-e2e"）
    // 並只操作該 sessionId，afterEach 也只關自己這筆，故此處不做任何破壞性清理。
    try {
      const conversions = await request.get(`${CONVERSION_API}/api/conversions`, { timeout: 10_000 });
      const body = await conversions.json();
      const items = Array.isArray(body?.items) ? body.items as ConversionItem[] : [];
      const conv = items.find((c) =>
        c.status === "succeeded" && c.ready !== false && Boolean((c.usdc_url || c.model?.url || c.artifacts?.model_usdc?.url) && (c.mapping_url || c.artifacts?.element_mapping?.url)),
      );
      const modelUrl = conv ? loopbackArtifactUrl(conv.usdc_url || conv.model?.url || conv.artifacts?.model_usdc?.url || "") : "";
      const mappingUrl = conv ? loopbackArtifactUrl(conv.mapping_url || conv.artifacts?.element_mapping?.url || "") : "";
      if (conv && modelUrl && mappingUrl) {
        const created = await request.post(`${COORDINATOR}/api/review-sessions`, {
          data: {
            project_id: conv.project_id || "project_demo_001",
            model_version_id: conv.model_version_id || "version_demo_001",
            created_by: "playwright-e2e",
            artifact_bindings: [
              {
                artifact_group_id: conv.artifact_group_id || `ag_${conv.model_version_id || "version_demo_001"}_${conv.conversion_job_id || "conversion"}`,
                artifact_id: conv.artifacts?.model_usdc?.artifact_id || `artifact_${conv.conversion_job_id || "conversion"}`,
                artifact_role: "derived",
                url: modelUrl,
                mapping_url: mappingUrl,
                load_order: 0,
                ready_status: "ready",
                conversion_authority: "bim-streaming-server",
                conversion_job_id: conv.conversion_job_id || "unknown",
                conversion_status: "ready",
              },
            ],
          },
          timeout: 20_000,
        });
        const parsed = await created.json().catch(() => ({}));
        sessionId = typeof parsed?.session_id === "string" ? parsed.session_id : "";
      }
    } catch {
      sessionId = "";
    }
    test.skip(!sessionId, "無 succeeded conversion 或無法建立 review session：需先備妥 :49101 conversion artifact");

    await page.goto(`${COORDINATOR}/ui/#/a1-workbench`, { waitUntil: "domcontentloaded" });
    // a1-session-select 只在 runtime/status 列出 active/created session 時 render；上面已建立本 spec 專屬
    // session，故它同時是「本 branch dist-ui」與「session 面板可用」的守門。
    const hasBranchUi = await page.getByTestId("a1-session-select").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true, () => false);
    test.skip(!hasBranchUi, "coordinator dist-ui 非本 branch（#a1-workbench 缺 a1-session-select）：需 npm run build:ui 後重啟 :8005");
  });

  test.afterEach(async ({ request }) => {
    if (!sessionId) return;
    await request.post(`${COORDINATOR}/api/review-sessions/${sessionId}/close`, { data: { reason: "e2e-teardown" }, timeout: 10_000 }).catch(() => {});
  });

  test("選 session → 啟動 A1 inline 3D → first frame observed + stage matched 截圖", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/#/a1-workbench`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("a1-session-select").selectOption(sessionId);

    // 選定 session 後 A1 inline 3D pane（ReviewSessionViewerPane mode="a1-inline"）render；
    // attach 是手動按鈕（A1 不自動 claim viewer lease）。disabled 時按鈕 caption 會顯示誠實理由
    //（viewer 入口缺 / session 未列出 / model artifact stale），timeout 失敗訊息可直接看到它。
    const startBtn = page.getByTestId("a1-inline-manual-start");
    await expect(startBtn).toBeEnabled({ timeout: 30_000 });
    await startBtn.click();
    await expect(page.getByTestId("a1-inline-viewer-host")).toBeVisible({ timeout: 30_000 });

    // runtime evidence（a1-inline-runtime-evidence）逐欄斷言：lease 已 claim → first frame observed →
    // stage truth matched。/\bobserved\b/ 不會誤配 not_observed（底線是 word char，無邊界）。
    const evidence = page.getByTestId("a1-inline-runtime-evidence");
    await expect(evidence.locator(".ec-field", { hasText: "primary lease" })).not.toContainText("not_started", { timeout: 30_000 });
    await expect(evidence.locator(".ec-field", { hasText: "first frame" })).toContainText(/\bobserved\b/, { timeout: 180_000 });
    await expect(evidence.locator(".ec-field", { hasText: "stage truth" })).toContainText("matched（expected == loaded）", { timeout: 30_000 });

    await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-firstframe.png", fullPage: true });
    // 多存一份到 tracked docs/evidence（artifacts/e2e/*.png 被 ignore、PR 看不到；此為 P4 可審 browser 證據）。
    await page.screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/firstframe-stage-matched.png", fullPage: true });
  });

  test("for-session 檢核 → a1-inline-highlight 高亮 ack（或誠實 disabled 理由）→ iframe 截圖", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/#/a1-workbench`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("a1-session-select").selectOption(sessionId);

    // 先把 inline viewer 帶到高亮前置狀態：lease → first frame → stage matched（highlight 四條件的 3D 半邊）。
    const startBtn = page.getByTestId("a1-inline-manual-start");
    await expect(startBtn).toBeEnabled({ timeout: 30_000 });
    await startBtn.click();
    const evidence = page.getByTestId("a1-inline-runtime-evidence");
    await expect(evidence.locator(".ec-field", { hasText: "first frame" })).toContainText(/\bobserved\b/, { timeout: 180_000 });
    await expect(evidence.locator(".ec-field", { hasText: "stage truth" })).toContainText("matched（expected == loaded）", { timeout: 30_000 });

    // rule-run 前置（A1 v2）：state machine 需先 PICK 一個 IFC 才 enable run 鈕（選 session 不再 auto-PICK）；
    // 手動 POST /api/review-sessions 建立的 session 不在 MinIO ifc-ready 對應內，故用 local_fs 檔案庫選第一個 IFC。
    // library:// 修復後：local_fs 選檔即使已綁 selectedSession，doRun 也對「使用者選定的檔案」走
    // POST /api/governance-library/rule-runs（coordinator server-side 由邏輯三段解析真路徑；
    // 瀏覽器不傳路徑——files/tree 的 path 已被 proxy 遮蔽成 "[server-path]"，不可回送）。
    // selectedSession 仍供 mapping enrichment 與 inline 3D 高亮 handoff（本測試後半的閉環）。
    const localSelect = page.getByTestId("a1-localfs-select");
    const firstLocal = localSelect.locator('option[value]:not([value=""])').first();
    const hasLocalIfc = await firstLocal.waitFor({ state: "attached", timeout: 15_000 }).then(() => true, () => false);
    test.skip(!hasLocalIfc, "local_fs 檔案庫無 IFC（GET /api/governance/files/tree 空或不可用）：A1 v2 需先 PICK IFC 才能啟動 rule-run");
    const localKey = (await firstLocal.getAttribute("value")) ?? ""; // option value = 唯一邏輯鍵（非 server path）
    await localSelect.selectOption(localKey);
    await page.getByTestId("a1-ids-path").fill(VG01_IDS_PATH);
    await page.getByTestId("a1-step-pick").click();

    const runBtn = page.getByTestId("a1-step-run");
    await expect(runBtn).toBeEnabled({ timeout: 5_000 });
    // 證明本次確實走 library 邏輯識別：local_fs 選檔後 run 鈕 caption 顯示 governance-library 端點。
    await expect(runBtn).toContainText("governance-library");
    await runBtn.click();

    // rule-run 仍可能誠實失敗（governance 離線 / library 樹變動 → 404 library_version_not_found），
    // doRun 因而 dispatch RUN_FAIL：step 停在 running+runError、記分板（state.run）永不出現。先 race 記分板（成功）
    // vs 檢核失敗註記（RUN_FAIL），避免對永不出現的記分板盲等 180s。
    const scoreboard = page.getByTestId("a1-rulerun-scoreboard");
    const runFailedNote = page.getByText("檢核失敗（可重試）");
    await expect(scoreboard.or(runFailedNote)).toBeVisible({ timeout: 180_000 });
    if (await runFailedNote.isVisible()) {
      test.info().annotations.push({ type: "library-rulerun-failed", description: (await runFailedNote.textContent())?.trim() ?? "" });
      test.skip(true, "library rule-run 失敗（RUN_FAIL 註記見 annotations）：governance 離線或 library version 解析不到；完整檢核 + inline 高亮閉環需 governance 在線與 files/tree 可解析的 IFC。");
    }
    await expect(scoreboard).toBeVisible({ timeout: 5_000 });

    // 高亮閉環：a1-inline-highlight（a1InlineHandoff 帶第一筆失敗構件）。已對映（mapping enrich 補到
    // usd_prim_path）且 lease / first frame / DataChannel / stage matched 齊 → enable → 點擊 → viewer ack；
    // 否則鈕誠實 disabled、a1-inline-highlight-reason 顯示不可高亮原因（未對映 / DataChannel 未就緒 /
    // stage 未對齊…），不偽造成功（skip != PASS、disabled != FAIL——兩路都是現行 UI 的誠實終態）。
    const highlightBtn = page.getByTestId("a1-inline-highlight");
    const highlightReason = page.getByTestId("a1-inline-highlight-reason");
    await expect(highlightBtn).toBeVisible({ timeout: 30_000 });
    const canHighlight = await expect(highlightBtn).toBeEnabled({ timeout: 30_000 }).then(() => true, () => false);
    // E2E_REQUIRE_HIGHLIGHT_ACK=1（fixture 齊備的證據跑）強制 ack 腿：把「高亮永久 disabled」
    // 的產品回歸（mapping 回填壞掉/DataChannel 判定壞掉）從軟腿 PASS 變硬 FAIL；
    // 未設時保留異質環境的誠實 disabled 腿（skip != PASS、disabled != FAIL）。
    if (process.env.E2E_REQUIRE_HIGHLIGHT_ACK === "1" && !canHighlight) {
      const reason = (await highlightReason.textContent().catch(() => null)) ?? "(no reason)";
      throw new Error(`E2E_REQUIRE_HIGHLIGHT_ACK=1 但高亮鈕 disabled：${reason}`);
    }
    if (canHighlight) {
      await highlightBtn.click();
      await expect(highlightReason).toContainText("已送出並收到 viewer 回報", { timeout: 30_000 });
      // runtime evidence 的 highlight ack 欄同步落地（viewer 回報，非樂觀 UI）。
      await expect(evidence.locator(".ec-field", { hasText: "highlight ack" })).toContainText("已送出並收到 viewer 回報");
      test.info().annotations.push({ type: "inline-highlight-acked", description: "a1-inline-highlight sent and acknowledged by viewer" });
    } else {
      const reason = (await highlightReason.textContent())?.trim() ?? "";
      expect(
        reason,
        "a1-inline-highlight disabled 時 a1-inline-highlight-reason 必須顯示誠實理由（未對映 / DataChannel / stage / lease），不得空白或假 ack",
      ).toMatch(/缺 usd_prim_path|mapping|缺 ifc_guid|等待 3D 第一幀|等待 viewer DataChannel|stage 未對齊|需先手動啟動|未列出此 session|尚未輸入有效/);
      test.info().annotations.push({ type: "inline-highlight-blocked-honest", description: reason });
    }

    // iframe 截圖（真 3D viewer 畫面）+ 全頁截圖：ack 與誠實 disabled 兩路皆落證據。
    await page.locator('iframe[title="live-3d-viewer"]').screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-inline-viewer.png" });
    await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-inline-full.png", fullPage: true });
    // 多存一份到 tracked docs/evidence（artifacts/e2e/*.png 被 ignore、PR 看不到）。
    await page.locator('iframe[title="live-3d-viewer"]').screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/inline-highlight-viewer.png" });
    await page.screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/inline-highlight-full.png", fullPage: true });
  });

  // 用 test.fixme 標「待補」而非 test.skip（skip 易被誤讀為「已考慮過、PASS 等價」；fixme 明確標記功能缺口）。
  // NOT BUILT：A1 inline handoff 目前只帶第一筆失敗構件（a1InlineHandoff 取 state.failed 首筆），缺列級高亮鈕；
  // 需列級鈕 + 專用含未對映構件 fixture 才能穩定選 unmapped 構件驗 reason=unmapped 誠實拒絕，不偽造此張。
  test.fixme("未對映構件誠實拒絕截圖（NOT BUILT: 列級高亮鈕）", async () => {
    // 待補：A1 加列級高亮鈕 + 未對映構件 fixture 後，驗 a1-inline-highlight-reason 顯示「未對映」誠實拒絕 + 截圖。
  });
});
