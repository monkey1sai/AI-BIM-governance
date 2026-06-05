import { test, expect } from "@playwright/test";

// RK6 CRITICAL：/ui/console 精確 301 → /ui，且「絕不」以 /ui/* 萬用吞掉凍結的 /ui/open handoff。
const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("ui-open regression（/ui/console 收斂 + /ui/open 凍結）", () => {
  test("/ui/console 精確 301→/ui；/ui/open?session= 仍 302 未被吞；/ui 200", async ({ page, request }) => {
    // /ui/console → 301 /ui（精確 route）。
    const consoleResp = await request.get(`${COORDINATOR}/ui/console`, { maxRedirects: 0 });
    expect(consoleResp.status()).toBe(301);
    expect(consoleResp.headers()["location"]).toBe("/ui");

    // /ui/open?session=... 仍 302 到 viewer，未被 /ui/console 或任何 /ui/* 萬用吞掉。
    const openResp = await request.get(`${COORDINATOR}/ui/open?session=review_session_demo`, { maxRedirects: 0 });
    expect(openResp.status()).toBe(302);
    const loc = openResp.headers()["location"] || "";
    expect(loc).toContain("session=review_session_demo");
    expect(loc).not.toBe("/ui");

    // /ui 服務 console（200）。
    const ui = await request.get(`${COORDINATOR}/ui`);
    expect(ui.status()).toBe(200);

    // 瀏覽器導航 /ui/console 最終落在 /ui。
    await page.goto(`${COORDINATOR}/ui/console`);
    await expect(page).toHaveURL(/\/ui$/);
    await page.screenshot({ path: "../artifacts/e2e/ui-open-regression.png", fullPage: true });
  });
});
