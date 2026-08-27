import { test, expect } from "@playwright/test";

// unified-console-runtime-truth slice 2 §5A：dev routes 已關閉的 UI 垂直切片。
// credential-bearing API probe 已移到 dev-routes-disabled-operator-token.api.spec.ts；
// 本檔只執行兩個 browser UI tests，且明確保留 trace 與 screenshot。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005";
const PREFLIGHT_TIMEOUT_MS = 10_000;

test.use({ trace: "on" });

function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS) });
}

async function uiPreflight(): Promise<string | null> {
  try {
    const health = await fetchWithTimeout(`${COORDINATOR}/health`);
    if (!health.ok) return `coordinator ${COORDINATOR}/health 非 2xx（${health.status}）`;
    const dev = await fetchWithTimeout(`${COORDINATOR}/api/dev/ifc-sources`);
    if (dev.status !== 404) {
      return `coordinator 未以 ENABLE_DEV_ROUTES=false 啟動（GET /api/dev/ifc-sources → ${dev.status}，預期 404）`;
    }
    return null;
  } catch (error) {
    return `coordinator ${COORDINATOR} 不可達：${String(error)}`;
  }
}

let uiPreflightReason: string | null = null;

test.beforeAll(async () => {
  uiPreflightReason = await uiPreflight();
});

test.beforeEach(() => {
  if (uiPreflightReason === null) return;
  throw new Error(
    `前置不齊備，本 UI spec 直接 fail（刻意不 skip）：${uiPreflightReason}。` +
      "請先依 plan Task 5A Step 2 起 branch coordinator（PORT=8005、ENABLE_DEV_ROUTES=false、" +
      "CORS_ORIGINS=http://127.0.0.1:5180）後重跑。",
  );
});

test.describe("dev routes 已關閉：UI 垂直切片誠實狀態", () => {
  test("#demo-control：/api/dev/ifc-sources 404 → notice ＋ 選檔／註冊鈕 disabled", async ({ page }) => {
    // 綁定真後端回應：notice 必須是由瀏覽器實際收到的 404 {detail:"dev routes disabled"} 觸發，
    // 而非任何其他 404（P4 attempt 1 gap e1）。
    const devSourcesResponse = page.waitForResponse(
      (response) => response.url().includes("/api/dev/ifc-sources") && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.goto("/#demo-control");
    const panel = page.getByTestId("real-ifc-demo-control");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const devSources = await devSourcesResponse;
    expect(devSources.status()).toBe(404);
    expect(await devSources.json()).toEqual({ detail: "dev routes disabled" });

    const notice = page.getByTestId("ifc-dev-routes-notice");
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText("dev routes 已關閉");
    await expect(notice).toContainText("ENABLE_DEV_ROUTES=false");

    await expect(page.getByTestId("ifc-fixture-select")).toBeDisabled();
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();

    // runtime 行必須是 dev_routes_disabled，不得退回 storage_empty 假空狀態（P4 attempt 1 gap e4）。
    const runtimeState = page.getByTestId("ifc-runtime-state");
    await expect(runtimeState).toContainText("runtime: dev_routes_disabled");
    await expect(runtimeState).not.toContainText("storage_empty");

    // 重新整理清單會再打一次 /api/dev/ifc-sources（仍 404）：notice／disabled／runtime 行必須維持（P4 attempt 1 gap e5）。
    const refreshResponse = page.waitForResponse(
      (response) => response.url().includes("/api/dev/ifc-sources") && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.getByTestId("ifc-refresh-btn").click();
    const refreshed = await refreshResponse;
    expect(refreshed.status()).toBe(404);
    expect(await refreshed.json()).toEqual({ detail: "dev routes disabled" });
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("ifc-register-btn")).toBeDisabled();
    await expect(runtimeState).toContainText("runtime: dev_routes_disabled");

    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-demo-control.png", fullPage: true });
  });

  test("#a1-workbench：/api/dev/test-data-projects 404 → 測試資料標記不可用 note", async ({ page }) => {
    const testDataProjectsResponse = page.waitForResponse(
      (response) => response.url().includes("/api/dev/test-data-projects") && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.goto("/#a1-workbench");
    const testDataProjects = await testDataProjectsResponse;
    expect(testDataProjects.status()).toBe(404);
    expect(await testDataProjects.json()).toEqual({ detail: "dev routes disabled" });
    // 預設 executable source 即 local_fs（A1GovernanceWorkbenchPage 初始 state），note 掛在
    // sourceKind==="local_fs" 分支下，故不需切換分頁即可觀察到。
    const localSelect = page.getByTestId("a1-localfs-select");
    await expect(localSelect).toBeVisible({ timeout: 20_000 });

    const note = page.getByTestId("a1-testdata-devroutes-note");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText("dev routes 已關閉");
    await expect(note).toContainText("ENABLE_DEV_ROUTES=false");

    await page.screenshot({ path: "../artifacts/e2e/dev-routes-disabled-a1-workbench.png", fullPage: true });
  });
});
