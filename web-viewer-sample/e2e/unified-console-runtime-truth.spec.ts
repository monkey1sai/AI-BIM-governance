import { test, expect, type APIRequestContext, type Page, type Request } from "@playwright/test";

// unified-console-runtime-truth slice 1 — P4 browser evidence（真後端：本機 coordinator :8004 服務的 dist-ui）。
// *** 前置（同 a1-m1-closeout.spec.ts 檔頭）：
//   1. cd web-viewer-sample && npm run build:ui        # 用本 branch 的碼重 build dist-ui
//   2. 重啟服務 :8004 的 coordinator（CONSOLE_DIST_DIR 指向該 dist-ui；docker 佔 :8004 時須重建容器）
//   3. coordinator 跑別的 port 只允許用 E2E_COORDINATOR_BASE_URL 指向「本機」stack；不得改打其他 host。
// 不可達 → test.skip 訊息前綴 `stack_down:`（E2E_REQUIRE_REAL=1 時 forbid-skipped reporter 視 skip 為失敗，不假綠）。
// 執行：$env:E2E_DISABLE_WEBSERVER='1'; npx playwright test e2e/unified-console-runtime-truth.spec.ts --reporter=list
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";
const SHOT = (name: string) => `../artifacts/e2e/unified-console-runtime-truth-${name}.png`;
const OFFLINE_HTTP = new Set([502, 503, 504]);
const IN_PROGRESS = new Set(["detected", "queued", "converting"]);

type Json = Record<string, unknown>;
async function api(request: APIRequestContext, path: string): Promise<{ status: number; body: Json | null }> {
  try {
    const res = await request.get(`${COORDINATOR}${path}`, { timeout: 10_000 });
    let body: Json | null = null;
    try { body = (await res.json()) as Json; } catch { body = null; }
    return { status: res.status(), body };
  } catch {
    return { status: 0, body: null };
  }
}
/** 前端渲染規則（runtimeTruth.ts cellText）的鏡像：2xx→format(body)；502/503/504／網路→「—」；其他非 2xx→狀態碼。 */
function expectedText(r: { status: number; body: Json | null }, format: (b: Json) => string): string {
  if (r.status >= 200 && r.status < 300 && r.body) return format(r.body);
  if (r.status === 0 || OFFLINE_HTTP.has(r.status)) return "—";
  return String(r.status);
}
const uc = (page: Page, id: string) => page.locator(`[data-uc="${id}"]`);
/** 一律先過 about:blank 造成 full document load（hash-only goto 是 same-document navigation，store 單例會存活）。 */
async function fresh(page: Page, hash: string): Promise<void> {
  await page.goto("about:blank");
  await page.goto(`${COORDINATOR}/ui${hash}`);
  await page.locator('[data-uc="page-root"]').waitFor({ state: "visible", timeout: 15_000 });
}

test.describe("unified-console-runtime-truth slice 1：/ui 預設入口真值（真後端 :8004）", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ request, page }) => {
    const probe = await api(request, "/api/runtime/status");
    test.skip(probe.status === 0, "stack_down: coordinator :8004 不可達（需本機 coordinator 啟動；不得改打其他 host）");
    let uiOk = false;
    try {
      await page.goto(`${COORDINATOR}/ui#home`);
      await page.locator('[data-uc="kpi-conv-val"]').waitFor({ state: "visible", timeout: 15_000 });
      uiOk = true;
    } catch {
      uiOk = false;
    }
    test.skip(!uiOk, "stack_down: :8004 服務的 dist-ui 非本 branch（#home 缺 kpi-conv-val）：npm run build:ui 後重啟 coordinator");
  });

  test("#home 四 KPI 與同分鐘 API JSON 一致；值帶 asbuilt＋四值 data-state；無 fixture 固定值", async ({ page, request }) => {
    await fresh(page, "#home");
    await expect.poll(async () => {
      const [rt, recs, issues, outbox] = await Promise.all([
        api(request, "/api/runtime/status"),
        api(request, "/api/conversion/records?limit=100"),
        api(request, "/api/governance/issues"),
        api(request, "/api/callback-outbox/summary?limit=200"),
      ]);
      const expected = {
        sess: expectedText(rt, (b) => String((b.sessions as Json).active_count)),
        conv: expectedText(recs, (b) => {
          const items = b.items as Json[];
          return (b.count as number) > items.length ? "未取得" : String(items.filter((r) => IN_PROGRESS.has(r.status as string)).length);
        }),
        issue: expectedText(issues, (b) => String((b.issues as Json[]).filter((i) => !["resolved", "rejected"].includes(i.status as string)).length)),
        outbox: expectedText(outbox, (b) => {
          const entries = b.entries as Json[];
          return (b.total as number) > entries.length ? "未取得" : String(entries.filter((e) => e.status === "pending").length);
        }),
      };
      const ui = {
        sess: await uc(page, "kpi-sess-val").textContent(),
        conv: await uc(page, "kpi-conv-val").textContent(),
        issue: await uc(page, "kpi-issue-val").textContent(),
        outbox: await uc(page, "kpi-outbox-val").textContent(),
      };
      return JSON.stringify(ui) === JSON.stringify(expected) ? "match" : `ui=${JSON.stringify(ui)} api=${JSON.stringify(expected)}`;
    }, { timeout: 30_000, intervals: [1_000] }).toBe("match");
    for (const id of ["kpi-conv-val", "kpi-sess-val", "kpi-issue-val", "kpi-outbox-val"]) {
      await expect(uc(page, id)).toHaveAttribute("data-prov", "asbuilt");
      await expect(uc(page, id)).toHaveAttribute("data-state", /^(live|unavailable|offline|error)$/);
    }
    await expect(page.locator('[data-uc="svc-dot"]')).toHaveCount(6);
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("2026-07-14");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("990_model.ifc");
    await page.screenshot({ path: SHOT("home"), fullPage: true });
  });

  test("#home KPI 卡為 nav：點「活躍 Sessions」導向 #sessions（legacy 真頁，無 page-root）", async ({ page }) => {
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess")).toHaveAttribute("data-action", "nav");
    await uc(page, "kpi-sess").click();
    await expect(page).toHaveURL(/#\/?sessions$/);
    await expect(page.locator('[data-uc="page-root"]')).toHaveCount(0);
  });

  test("#pipeline 五段真值＋runtime ID（Kit instance／session handoff）；不打 /api/internal、/api/dev；觸發轉檔 disabled 不發請求", async ({ page, request }) => {
    const urls: string[] = [];
    page.on("request", (req: Request) => { urls.push(req.url()); });
    await fresh(page, "#pipeline");
    const kit = await api(request, "/api/kit/instances/current");
    await expect(uc(page, "kit-instance-val")).toHaveText(expectedText(kit, (b) => `${b.instance_id} ${b.status}`), { timeout: 20_000 });
    const rt = await api(request, "/api/runtime/status");
    if (rt.status === 200 && rt.body) {
      const sessions = rt.body.sessions as Json;
      const items = sessions.items as Json[];
      await expect(uc(page, "sess-active-val")).toHaveText(String(sessions.active_count));
      if (items.length === 0) {
        await expect(uc(page, "handoff-none")).toBeVisible();
      } else {
        await expect(page.locator('[data-uc="handoff-link"]')).toHaveCount(items.length);
        await expect(page.locator('[data-uc="handoff-link"]').first()).toHaveAttribute("href", new RegExp(`/ui/open\\?session=${String(items[0].session_id)}`));
        await expect(page.locator('[data-uc="handoff-link"]').first()).toHaveAttribute("target", "_blank");
      }
    } else {
      await expect(uc(page, "handoff-state")).toBeVisible();
    }
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(uc(page, "rvt-retired")).toContainText("已退役");
    await expect(uc(page, "trigger-conv")).toHaveAttribute("aria-disabled", "true");
    await uc(page, "trigger-conv").click({ force: true });
    await page.waitForTimeout(1_000);
    expect(urls.filter((u) => u.includes("/api/conversion/trigger"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/api/internal/") || u.includes("/api/dev/"))).toEqual([]);
    expect(urls.filter((u) => u.includes("/api/callback-outbox/summary")).length).toBeGreaterThan(0);
    await page.screenshot({ path: SHOT("pipeline"), fullPage: true });
  });

  test("#runtime：GPU 未取得（unavailable，非數字）、Kit instance 真值、六 svc-dot、事件列 disabled", async ({ page, request }) => {
    await fresh(page, "#runtime");
    const rt = await api(request, "/api/runtime/status");
    const kit = await api(request, "/api/kit/instances/current");
    await expect(uc(page, "kit-instance-id")).toHaveText(expectedText(kit, (b) => String(b.instance_id)), { timeout: 20_000 });
    await expect(uc(page, "gpu-val")).toHaveText(expectedText(rt, () => "未取得"));
    await expect(uc(page, "gpu-val")).toHaveAttribute("data-state", rt.status === 200 ? "unavailable" : /^(offline|error)$/);
    await expect(page.locator('[data-uc="svc-dot"]')).toHaveCount(6);
    for (const dot of await page.locator('[data-uc="svc-dot"]').all()) {
      expect(await dot.getAttribute("data-health")).toMatch(/^(ok|degraded|unknown)$/);
    }
    await expect(uc(page, "events-disabled")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("82%");
    await expect(page.locator('[data-uc="page-root"]')).not.toContainText("14.6/24 GB");
    await page.screenshot({ path: SHOT("runtime"), fullPage: true });
  });

  test("failure → retry：/api/** 503 時 KPI 顯示 —／未連線；解除後於退避上限內恢復 live", async ({ page }) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "e2e_offline" }) }));
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess-val")).toHaveText("—");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "offline");
    await expect(uc(page, "kpi-sess-sub")).toHaveText("未連線");
    await expect(uc(page, "last-updated")).toContainText("—");
    await expect(uc(page, "chip-coordinator")).toHaveAttribute("data-health", "unknown");
    await page.screenshot({ path: SHOT("offline"), fullPage: true });
    await page.unroute("**/api/**");
    // 退避：10s→20s→40s（上限 60s）；解除 stub 後最遲於下一輪（≤60s）恢復。
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "live", { timeout: 75_000 });
    await expect(uc(page, "last-updated")).toHaveText(/最後更新 \d{2}:\d{2}:\d{2}/);
  });

  test("loading：API 延遲時先顯示 —（永不以 0 佔位），回應後轉 live", async ({ page }) => {
    await page.route("**/api/runtime/status", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });
    await fresh(page, "#home");
    await expect(uc(page, "kpi-sess-val")).toHaveText("—");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", "offline");
    await expect(uc(page, "kpi-sess-val")).toHaveAttribute("data-state", /^(live|error)$/, { timeout: 20_000 });
    await page.unroute("**/api/runtime/status");
  });

  test("共用 poller：#pipeline（殼層與頁面同訂閱 /api/runtime/status）10.5s 內同端點請求 ≤ 2（初次＋一輪）", async ({ page }) => {
    const hits: number[] = [];
    page.on("request", (req: Request) => { if (req.url().includes("/api/runtime/status")) hits.push(Date.now()); });
    await fresh(page, "#pipeline");
    await page.waitForTimeout(10_500);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.length).toBeLessThanOrEqual(2);
  });
});
