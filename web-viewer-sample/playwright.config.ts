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
    baseURL: process.env.E2E_VIEWER_BASE_URL || "http://127.0.0.1:5180",
    trace: "on",
    screenshot: "on",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // 專用 E2E port 5180（strictPort + reuseExistingServer:false）：Playwright 每次起一台全新、確定是本 repo
  // 最新碼的 viewer dev server，避開被 docker 容器佔用的 5173/5174，杜絕「打到陳舊 server」的假象。
  // env：把 viewer 的 coordinator client base（build-time VITE_COORDINATOR_API_BASE，見
  // src/console/coordinatorClient.ts / src/config/env.ts）綁到 E2E_COORDINATOR_BASE_URL（缺省
  // http://127.0.0.1:8005 branch coordinator）。Vite 只把 VITE_* 從 dev server 進程 env 注入
  // import.meta.env，故必須在此 webServer 進程顯式注入，否則 env.ts 會 fallback :8004，browser POST
  // 打不到 :8005，conv-coverage-report / conv-prioritize-retry 兩支 spec 的真切片無法命中 branch coordinator。
  webServer: [
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_COORDINATOR_API_BASE:
          process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005",
      },
    },
  ],
});
