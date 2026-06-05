import { defineConfig, devices } from "@playwright/test";

// 前端 E2E 設定。
// - viewer dev server（:5173）由 webServer 自動啟動（reuse 既有）。
// - coordinator（:8004）視測試需要另行啟動（console / intake 類測試）；viewer harness 開機測試不需 coordinator。
// - 截圖 / trace / video 落在 repo 根 artifacts/e2e（對齊任務指定路徑）。
// - harness 模式由各測試以 ?harness=1 query 開啟（dev build 下生效），不污染 prod。
export default defineConfig({
  testDir: "./e2e",
  outputDir: "../artifacts/e2e/_output",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../artifacts/e2e/report", open: "never" }],
  ],
  use: {
    baseURL: process.env.E2E_VIEWER_BASE_URL || "http://127.0.0.1:5174",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
