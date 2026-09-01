import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "design-system-visual.spec.ts",
  outputDir: "../artifacts/e2e/design-system-visual/_playwright-output",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: "../artifacts/e2e/design-system-visual/report",
        open: "never",
      },
    ],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:5182",
    browserName: "chromium",
    deviceScaleFactor: 1,
    locale: "zh-TW",
    timezoneId: "Asia/Taipei",
    colorScheme: "dark",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium-dpr1" }],
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5182 --strictPort",
    url: "http://127.0.0.1:5182",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      VITE_COORDINATOR_API_BASE: "http://127.0.0.1:8005",
      VITE_ALLOWED_COORDINATOR_ORIGINS: "http://127.0.0.1:8005",
      VITE_VIEWER_HARNESS: "1",
    },
  },
});
