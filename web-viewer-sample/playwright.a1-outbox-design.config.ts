import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: "a1-outbox-design.spec.ts", workers: 1, retries: 0,
  timeout: 60_000, outputDir: "../artifacts/e2e/a1-outbox-design", reporter: "list",
  use: { browserName: "chromium", deviceScaleFactor: 1, locale: "zh-TW", timezoneId: "Asia/Taipei",
    colorScheme: "dark", trace: "on", serviceWorkers: "block", baseURL: "http://127.0.0.1:5183" },
  webServer: { command: "npx vite --config e2e/support/a1-outbox-preview.config.ts", url: "http://127.0.0.1:5183/e2e/support/a1-outbox-preview.html",
    timeout: 60_000, reuseExistingServer: false },
});
