import { expect, test, type Page, type Route } from "@playwright/test";

// Browser-semantic acceptance for the converged shell. API responses here are
// controlled test doubles and therefore do NOT constitute live Kit/runtime E2E.
// The spec intentionally proves fail-closed UI states before any viewer lease,
// first frame, stage proof, DataChannel readiness, or ACK is observed.

const SESSION_ID = "review_session_e2e";
const STAGE_URL = "https://artifacts.invalid/federated_review.usda";

const runtimeStatus = {
  configured_endpoints: {
    viewer: { browser_url_base: "http://127.0.0.1:5180" },
    coordinator: { public_base_url: "http://127.0.0.1:8005" },
  },
  sessions: {
    count: 1,
    active_count: 1,
    participant_count: 0,
    items: [{
      session_id: SESSION_ID,
      status: "active",
      project_id: "e2e-project",
      model_version_id: "federated_fs_e2e",
      participant_count: 0,
      expected_stage_url: STAGE_URL,
      conversion_status: "succeeded",
      kit_instance_ids: ["kit-e2e"],
      created_at: "2026-09-02T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      viewer_leases: [],
      artifact_health: {
        source_ifc_exists: true,
        model_usdc_reachable: true,
        mapping_reachable: true,
        metadata_reachable: true,
        all_required_ready: true,
        checked_at: "2026-09-02T00:00:00Z",
        stale_reason: null,
        source: "edge_health_probe",
      },
    }],
  },
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installControlledApis(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/runtime/status") return json(route, runtimeStatus);
    if (path === "/api/kit/instances/current") {
      return json(route, { instance_id: "kit-e2e", status: "idle", gpu_index: 0 });
    }
    if (path === "/api/governance/search/llm-status") {
      return json(route, { enabled: false, configured: false, state: "unavailable", freshness: "unknown", check_source: "config", checked_at: null, ttl_s: 0 });
    }
    if (path === "/api/external/ifc-ready") return json(route, { count: 0, items: [] });
    return json(route, { detail: "controlled_browser_test_unavailable" }, 503);
  });
}

test.describe("Unified A1-A4 browser semantics (controlled APIs, not live runtime)", () => {
  test("all four canonical hashes mount live modules and contain no prototype viewport", async ({ page }) => {
    await installControlledApis(page);
    const expectations = [
      ["a1", "A1 · 治理與模型檢核"],
      ["a2", "模型版本差異與責任追蹤 · A2"],
      ["a3", "跨專業模型 Federation · A3"],
      ["a4", "A4 語意查詢與證據"],
    ] as const;

    for (const [route, heading] of expectations) {
      await page.goto(`/#${route}`);
      await expect(page.locator("[data-uc='unified-live-workspace']")).toBeVisible();
      await expect(page.locator(`[data-uc='live-module-${route}']`)).toContainText(heading);
      await expect(page.locator("[data-uc='viewport'][data-prov='demo']")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("rule-run #88");
      await expect(page.locator("body")).not.toContainText("openedStageResult ✓");
    }
  });

  test("A3 creates the real session-shaped handoff but labels missing element mapping unsupported", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/runtime/status") return json(route, runtimeStatus);
      if (path === "/api/kit/instances/current") return json(route, { instance_id: "kit-e2e", status: "idle" });
      if (path === "/api/governance/federated-sets" && request.method() === "POST") return json(route, { set_id: "fs_e2e", status: "created" });
      if (/\/api\/governance\/federated-sets\/fs_e2e\/members$/.test(path)) return json(route, { member_id: "member-e2e" });
      if (path.endsWith("/validate-coords")) return json(route, { consistent: true, members: {}, issues: [] });
      if (path.endsWith("/build")) return json(route, { usda_path: STAGE_URL, sublayer_order: ["ARC", "STR"], member_count: 2, hidden: [] });
      if (path.endsWith("/review-room")) return json(route, {
        set_id: "fs_e2e",
        ready: true,
        stage_url: "[server-path]",
        stage_composition: { primary: { url: "[server-path]", name: "federated_review", discipline: "FED" }, secondary_layers: [] },
        note: "server-resolved",
      });
      if (path === "/api/review-sessions" && request.method() === "POST") {
        const body = request.postDataJSON();
        expect(body.federated_set_id).toBe("fs_e2e");
        expect(body).not.toHaveProperty("stage_composition");
        return json(route, { session_id: SESSION_ID, status: "active", project_id: "federation-demo", model_version_id: "federated_fs_e2e" });
      }
      return json(route, { detail: "controlled_browser_test_unavailable" }, 503);
    });

    await page.goto("/#a3");
    await page.getByRole("button", { name: "準備 + 驗證坐標系" }).click();
    await page.getByRole("button", { name: "Build Federated USD" }).click();
    await page.getByRole("button", { name: "Open in Review Room" }).click();
    await page.getByTestId("a3-create-session").click();

    await expect(page.getByTestId("a3-inline-manual-start")).toBeVisible();
    await expect(page.getByTestId("a3-inline-runtime-evidence")).toContainText("not_observed");
    await expect(page.getByTestId("a3-element-selection-unsupported")).toContainText("Unsupported");
    await expect(page.getByTestId("a3-inline-highlight")).toHaveCount(0);
  });

  test("A4 mapped result remains blocked until the independent Kit evidence gates and viewer ACK", async ({ page }) => {
    await page.addInitScript((sessionId) => {
      window.sessionStorage.setItem("aibim:a4-session-context", sessionId);
    }, SESSION_ID);
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/runtime/status") return json(route, runtimeStatus);
      if (path === "/api/kit/instances/current") return json(route, { instance_id: "kit-e2e", status: "idle" });
      if (path === "/api/governance/search/llm-status") return json(route, { enabled: false, configured: false, state: "unavailable", freshness: "unknown", check_source: "config", checked_at: null, ttl_s: 0 });
      if (path === "/api/external/ifc-ready") return json(route, { count: 0, items: [] });
      if (path.includes(`/api/governance/search/model/for-session/${SESSION_ID}`)) {
        return json(route, {
          status: "ok",
          query_id: "a4_q_e2e",
          interpreted_filters: {},
          results: [{
            ifc_guid: "guid-door-e2e",
            usd_prim_path: "/World/Door_E2E",
            ifc_class: "IfcDoor",
            name: "Door E2E",
            storey: "4F",
            properties: { FireRating: 30 },
            evidence_refs: ["controlled:e2e"],
            evidence_proof: "a4p.controlled.e2e",
            highlight_eligible: true,
          }],
          stats: { total: 1, matched: 1, unmapped: 0, scanned: 1 },
          evidence_refs: [],
        });
      }
      return json(route, { detail: "controlled_browser_test_unavailable" }, 503);
    });

    await page.goto("/#a4");
    await expect(page.getByTestId("a4-inline-runtime-evidence")).toContainText("not_observed");
    await page.getByTestId("a4-run").click();
    await page.getByTestId("a4-row-guid-door-e2e").click();

    // 7ca6466（fix(viewer): 封鎖未授權 A4 高亮回應）：A4 對 pane 傳 showHandoffActions=false，pane 端的 handoff summary／
    // 單筆 highlight 面板不渲染；A4 的 3D 動作改走 coordinator 驗證的 handoff（a4-focus-handoff／a4-handoff-unavailable）。
    // 原斷言（期待 a4-inline-handoff-summary）與該 commit 矛盾、於 main 亦紅；此處對齊現行契約。
    await expect(page.getByTestId("a4-inline-handoff-summary")).toHaveCount(0);
    await expect(page.getByTestId("a4-inline-highlight")).toHaveCount(0);
    await expect(page.getByTestId("a4-focus-handoff").or(page.getByTestId("a4-handoff-unavailable"))).toHaveCount(1);
  });

  // introduce-viewer-app-integration-surface S3a DoD（tasks 4.3）：單次 goto 進站（hash-only、無 search），其後導覽一律
  // 頁內 client-side 點擊；ViewportHost 為同一節點（data-mount-token 不變）跨 #a1↔#a2↔#a3↔#a4；console top document 無 <video>
  //（R-D1 驗證項）。API 為受控 stub（runtime/status 200）→ host live 但未發布 handoff 時為誠實空態、無 iframe。
  test("viewport host persists across client-side dock switches and the top document has no video", async ({ page }) => {
    await installControlledApis(page);
    await page.goto("/#a1");
    const host = page.locator("[data-uc='viewport'][data-prov='asbuilt']");
    await expect(host).toHaveCount(1);
    await expect(host.locator("..")).toHaveAttribute("data-uc", "page-root");
    const token = await host.getAttribute("data-mount-token");
    expect(token).toBeTruthy();
    for (const dock of ["a2", "a3", "a4", "issues"] as const) {
      await page.locator(`[data-uc='dock-tab-${dock}']`).click();
      await expect(page.locator(`[data-uc='live-module-${dock}']`)).toBeVisible();
      await expect(host).toHaveAttribute("data-mount-token", token!);
    }
    await expect(page.locator("video")).toHaveCount(0);
    await expect(page.locator("iframe[src*='/ui/open']")).toHaveCount(0);
    await expect(page.locator("[data-uc='ws-stage-tree']")).toHaveAttribute("data-state", "unsupported");
    await expect(page.locator("[data-uc='ws-flow-guide']")).toBeVisible();
    await expect(page.locator("[data-uc='viewport'][data-prov='demo']")).toHaveCount(0);
  });

  // 設計正本 §03 統一主鍵語法 #workspace?dock=… 為 alias，渲染同一 WorkspacePage（dock=a4 維持既有 scrub alias → #a4）。
  test("#workspace?dock alias renders the same unified workspace", async ({ page }) => {
    await installControlledApis(page);
    await page.goto("/#workspace?dock=a2");
    await expect(page.locator("[data-uc='unified-live-workspace']")).toBeVisible();
    await expect(page.locator("[data-uc='live-module-a2']")).toContainText("模型版本差異與責任追蹤 · A2");
    await expect(page.locator("[data-uc='dock-tab-a2']")).toHaveAttribute("data-active", "true");
  });
});
