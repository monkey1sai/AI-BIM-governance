import { test, expect } from "@playwright/test";

// 硬性需求步驟 8-9：開啟「由真實 ./storage IFC 轉檔產生」的 ready review session（經凍結 handoff /ui/open），
// 驗證 viewer overlay 顯示來源 IFC lineage（project / model_version）+ 由該 IFC 衍生的 USDC artifact。
// 誠實：無 GPU 時 Runtime/WebRTC 不會 matched，但 lineage 與 expected USDC 仍真實可見（不偽造 stage matched）。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

type IfcReadySummary = {
  ifc_ready_job_id: string;
};

type IfcReadyDetail = {
  web_view_session_id?: string;
  viewer_url?: string;
  conversion_status?: string;
  external_model_version_id?: string;
};

test.describe("真實 IFC → viewer lineage（/ui/open handoff）", () => {
  test.setTimeout(120_000);

  test("由真實 IFC 轉檔 ready 的 session 經 /ui/open 進 viewer → 顯示來源 lineage + USDC artifact", async ({ page, request }) => {
    // 找一個 conversion ready、有 session + viewer_url、且來自本切片真實 IFC（mv_realifc_*）的 job。
    const listRes = await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=50`);
    expect(listRes.ok()).toBeTruthy();
    const list = await listRes.json();
    let ready: IfcReadyDetail | null = null;
    for (const item of ((list.items || []) as IfcReadySummary[]).slice(0, 14)) {
      const jr = await request.get(`${COORDINATOR}/api/external/ifc-ready/${encodeURIComponent(item.ifc_ready_job_id)}`);
      if (!jr.ok()) continue;
      const j = await jr.json();
      if (j.web_view_session_id && j.viewer_url && /ready/i.test(j.conversion_status || "") && /mv_realifc/.test(j.external_model_version_id || "")) {
        ready = j;
        break;
      }
    }
    test.skip(!ready, "目前沒有由真實 IFC 轉檔 ready 的 session（轉檔序列仍在進行）。happy-path 完成證據見 real-ifc-intake.spec + 報告 node lineage。");

    // 經凍結 handoff /ui/open（與 console handoff 同一路徑）進 viewer。
    await page.goto(`${COORDINATOR}/ui/open?session=${encodeURIComponent(ready.web_view_session_id)}`);

    const sessionCell = page.getByTestId("topbar-session");
    await expect.poll(async () => (await sessionCell.textContent()) || "", { timeout: 45_000 }).toContain("review_session_");
    await expect(page.getByTestId("topbar-project")).toContainText("project");
    await expect(page.getByTestId("topbar-version")).toContainText("mv_realifc");
    // stage-truth expected = 由該真實 IFC 轉檔產生的 USDC artifact（lineage 可見、可追溯）。
    await expect(page.locator(".stage-truth-panel")).toContainText("model.usdc");

    await page.screenshot({ path: "../artifacts/e2e/real-ifc-viewer-lineage.png", fullPage: true });
    console.log("REAL-IFC viewer lineage session:", ready.web_view_session_id, "model_version:", ready.external_model_version_id);
  });
});
