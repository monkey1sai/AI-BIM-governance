import { test, expect } from "@playwright/test";
import path from "node:path";

// VG-01：A1 工作台嵌入 live viewer → first_frame 綠燈 / stage matched → 失敗構件 3D 紅高亮。
//
// *** cross-build-target 前置（乾淨環境必做，否則「改了沒效」假象）：
//     1. cd web-viewer-sample && npm run build:ui
//     2. 重啟 branch coordinator(:8005) 服務新的 dist-ui，且 VIEWER_PUBLIC_BASE_URL 指到 Playwright fresh viewer(:5180)。
//     3. Playwright 會用本 branch 最新碼啟 viewer dev server(:5180)。
//     4. conversion authority(:49101) 需已有 succeeded conversion；本 spec 每個 test 會自建 / 關閉 session。
//     未重建 console 或 viewer 任一 target → 本 spec 觀察到的可能是陳舊碼，不算驗證。
//
// *** skip-gate 效力限制（誠實揭露，比照 a1-m1-closeout.spec.ts）：
//     beforeEach 只對「前置不存在」做 conditional skip（branch coordinator 不通、無 succeeded conversion、
//     dist-ui 缺本 branch testid）。Playwright 會把 skip 計入非失敗結果，但 skip != PASS。
//     真 PASS 必須看到 first_frame / stage matched / highlight_result OK，並落截圖。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const CONVERSION_API = process.env.E2E_CONVERSION_API_BASE || "http://127.0.0.1:49101";
const VG01_IDS_PATH = process.env.E2E_A1_IDS_PATH || path.resolve("..", "governance-service", "rules", "vg01-highlight-column.ids");
// rule-run 的 IFC source path：非開發機 / CI 須設 E2E_A1_IFC_PATH 指向 server-side、含 IFCCOLUMN 的 IFC，
// 否則 A1 頁 fallback 到硬碼 defaultA1IfcPath（僅本開發機 storage 存在）→ rule-run ifc_source_path not found
// → a1-highlight-3d 永不 enable → 紅高亮 test 30s timeout 假失敗（對抗驗證 §4 high 缺口）。
const VG01_IFC_PATH = process.env.E2E_A1_IFC_PATH || "";

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

test.describe("VG-01：A1 嵌入 viewer + 3D 高亮", () => {
  test.setTimeout(360_000);

  let sessionId = "";
  // conversion 的 source IFC server-side 路徑（rule-run 須對到此 IFC，failed column guid 才會在 element_mapping
  // 找得到 → 可高亮）；beforeEach 從 conversion detail 取得，test 2 fill 進 a1-step-path。比 E2E_A1_IFC_PATH env
  // 更穩健（自動對應當前 conversion，CI 通用）。
  let ifcSourcePath = "";

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
        // 取 conversion 的 source IFC server-side 路徑（rule-run 對應；host-native governance 讀 host_local_path）。
        ifcSourcePath = "";
        try {
          const detailRes = await request.get(`${CONVERSION_API}/api/conversions/${conv.conversion_job_id}`, { timeout: 10_000 });
          const detail = await detailRes.json();
          ifcSourcePath = (detail?.ifc_artifact?.host_local_path as string) || (detail?.ifc_artifact?.local_path as string) || "";
        } catch {
          ifcSourcePath = "";
        }
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

    await page.goto(`${COORDINATOR}/ui/#/a1`, { waitUntil: "domcontentloaded" });
    const hasBranchUi = await page.getByTestId("a1-session-select").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true, () => false);
    test.skip(!hasBranchUi, "coordinator dist-ui 非本 branch：需 npm run build:ui 後重啟 :8005");
  });

  test.afterEach(async ({ request }) => {
    if (!sessionId) return;
    await request.post(`${COORDINATOR}/api/review-sessions/${sessionId}/close`, { data: { reason: "e2e-teardown" }, timeout: 10_000 }).catch(() => {});
  });

  test("first frame 綠燈 + stage matched 截圖", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/#/a1`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("a1-session-select").selectOption(sessionId);

    await expect(page.getByTestId("a1-first-frame-evidence")).toContainText("已收到真畫面", { timeout: 180_000 });
    await expect(page.getByTestId("a1-stage-matched")).toContainText("matched（expected == loaded）", { timeout: 30_000 });
    await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-firstframe.png", fullPage: true });
    // 多存一份到 tracked docs/evidence（artifacts/e2e/*.png 被 ignore、PR 看不到；此為 P4 可審 browser 證據）。
    await page.screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/firstframe-stage-matched.png", fullPage: true });
  });

  test("失敗構件 3D 紅高亮（已對映）截圖", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui/#/a1`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("a1-session-select").selectOption(sessionId);

    await expect(page.getByTestId("a1-first-frame-evidence")).toContainText("已收到真畫面", { timeout: 180_000 });
    await expect(page.getByTestId("a1-stage-matched")).toContainText("matched（expected == loaded）", { timeout: 30_000 });

    // model-path（對抗驗證 §4 high）：rule-run 須對 conversion 的 source IFC（ifcSourcePath，beforeEach 從
    // conversion detail 取得），failed column guid 才在 session element_mapping 找得到 → 可高亮。
    // E2E_A1_IFC_PATH 為手動 override（優先）；兩者皆無才沿用 A1 頁 defaultA1IfcPath（fixture-bytes 無 IFCCOLUMN）。
    const ifcPath = VG01_IFC_PATH || ifcSourcePath;
    if (ifcPath) await page.getByTestId("a1-step-path").fill(ifcPath);
    await page.getByTestId("a1-ids-path").fill(VG01_IDS_PATH);
    await page.getByTestId("a1-step-pick").click();
    await expect(page.getByTestId("a1-step-run")).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId("a1-step-run").click();
    await expect(page.getByTestId("a1-rulerun-scoreboard")).toBeVisible({ timeout: 180_000 });
    // failed>0 前置：vg01-highlight-column.ids 須對含 IFCCOLUMN 的 IFC 跑出失敗構件，否則無構件可高亮。
    // 記分板的 "failed" 為固定 label（恆存在，無法驗 >0），故以 a1-highlight-3d enable 作實質前置——
    // 它 enable 隱含「有失敗構件 ∧ IX-A1-06 四條件滿足」；failed=0 時會在此得到 30s timeout（非神秘卡死）。
    await expect(page.getByTestId("a1-highlight-3d")).toBeEnabled({ timeout: 30_000 });

    await page.getByTestId("a1-highlight-3d").click();
    await expect(page.getByTestId("a1-highlight-status")).toContainText("已在 3D 標示", { timeout: 30_000 });
    await page.locator('iframe[title="live-3d-viewer"]').screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-redhighlight-viewer.png" });
    await page.screenshot({ path: "../artifacts/e2e/viewer-embed-a1-highlight-redhighlight.png", fullPage: true });
    // 多存一份到 tracked docs/evidence（PR 可審的紅高亮證據）。
    await page.locator('iframe[title="live-3d-viewer"]').screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/redhighlight-viewer.png" });
    await page.screenshot({ path: "../docs/evidence/viewer-embed-a1-highlight/redhighlight-full.png", fullPage: true });
  });

  // 用 test.fixme 標「待補」而非 test.skip（skip 易被誤讀為「已考慮過、PASS 等價」；fixme 明確標記功能缺口）。
  // NOT BUILT：A1 頁目前只暴露第一筆失敗構件的高亮鈕，缺列級鈕；需專用 fixture / 列級高亮鈕才能穩定選 unmapped 構件，不偽造此張。
  test.fixme("未對映構件誠實拒絕截圖（NOT BUILT: 列級高亮鈕）", async () => {
    // 待補：A1 頁加列級高亮鈕 + 專用含未對映構件 fixture 後，驗 highlight_result reason=unmapped 的誠實拒絕 UI + 截圖。
  });
});
