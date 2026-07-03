import { test, expect } from "@playwright/test";

// 真實 IFC→USDC 轉檔產物 lineage：由真實 ./storage IFC 轉檔 ready 的 session，驗證確實產出
// model.usdc + element_mapping.json + artifact_id（非 mock），並在 viewer UI 可見該 USDC stage URL。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

type IfcReadySummary = {
  ifc_ready_job_id: string;
};

type IfcReadyDetail = {
  web_view_session_id?: string;
  conversion_status?: string;
  external_model_version_id?: string;
  conversion_job_id?: string;
};

test.describe("real-ifc-conversion-lineage：真實 IFC→USDC 轉檔產物 metadata", () => {
  test.setTimeout(90_000);

  test("ready 的真實 IFC 轉檔 → model.usdc + element_mapping + artifact_id，UI 可見 USDC", async ({ page, request }) => {
    const list = await (await request.get(`${COORDINATOR}/api/external/ifc-ready?limit=30`)).json();
    let ready: IfcReadyDetail | null = null;
    for (const it of ((list.items || []) as IfcReadySummary[]).slice(0, 16)) {
      const j = await (await request.get(`${COORDINATOR}/api/external/ifc-ready/${encodeURIComponent(it.ifc_ready_job_id)}`)).json();
      if (j.web_view_session_id && /ready/i.test(j.conversion_status || "") && /mv_realifc/.test(j.external_model_version_id || "")) {
        ready = j;
        break;
      }
    }
    test.skip(!ready, "目前無真實 IFC 轉檔 ready 的 session（轉檔序列仍在進行）。conversion 成功證據另見 real-ifc-storage-intake + 報告。");

    // 轉檔產物 metadata（真實衍生物，非 mock）。
    const sc = await (await request.get(`${COORDINATOR}/api/review-sessions/${encodeURIComponent(ready.web_view_session_id)}/stream-config`)).json();
    expect(sc.model.status).toBe("ready");
    expect(sc.model.url, "model.usdc 由真實 IFC 轉檔產生").toContain("model.usdc");
    expect(sc.model.artifact_id, "artifact_id 存在").toBeTruthy();
    expect(String(sc.model.mapping_url || ""), "element_mapping.json 由轉檔產生").toContain("element_mapping.json");

    // UI 可見：經 /ui/open 進 viewer，viewport 狀態列顯示該 USDC artifact（lineage 可追溯）。
    await page.goto(`${COORDINATOR}/ui/open?session=${encodeURIComponent(ready.web_view_session_id)}`);
    await expect.poll(async () => (await page.getByTestId("topbar-session").textContent()) || "", { timeout: 40_000 }).toContain("review_session_");
    await expect(page.getByTestId("mock-stage-url")).toContainText("model.usdc");
    await page.screenshot({ path: "../artifacts/e2e/real-ifc-conversion-lineage.png", fullPage: true });

    console.log("conversion lineage | job:", ready.conversion_job_id, "| usdc:", sc.model.url, "| mapping:", sc.model.mapping_url, "| artifact:", sc.model.artifact_id);
  });
});
