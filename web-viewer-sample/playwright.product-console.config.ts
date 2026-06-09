import { defineConfig, devices } from "@playwright/test";

// Product console E2E targets an already-served coordinator /ui bundle.
// It intentionally avoids the viewer webServer from playwright.config.ts.
export default defineConfig({
  testDir: "./e2e",
  // 僅跑產品操作台 evidence specs；不收 viewer-harness 等需 webServer/baseURL 的 spec（避免相對導航失敗或誤跑無關套件）。
  testMatch: ["product-console-integration.spec.ts", "unified-console-routes.spec.ts"],
  outputDir: "../artifacts/e2e/_product_console_output",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "../artifacts/e2e/product-console-report", open: "never" }],
  ],
  use: {
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
