import { defineConfig, devices } from "@playwright/test";

const kitManagerPort = 5194;
const kitManagerOrigin = `http://127.0.0.1:${kitManagerPort}`;
const coordinatorOrigin = "http://127.0.0.1:8006";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "kit-manager-operator.spec.ts",
  outputDir: "../artifacts/e2e/kit-manager-output",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: kitManagerOrigin,
    trace: "on",
    screenshot: "on",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm --prefix ../apps/kit-manager-web run dev -- --host 127.0.0.1 --port ${kitManagerPort} --strictPort`,
    url: kitManagerOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_COORDINATOR_API_BASE: coordinatorOrigin,
      VITE_VIEWER_URL: "http://127.0.0.1:5180",
    },
  },
});
