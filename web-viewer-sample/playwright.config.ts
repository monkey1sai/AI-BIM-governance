import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadIsolatedStackConfig, parseStandaloneViewerPort } from "./e2e/support/isolated-stack";

const isolated = loadIsolatedStackConfig();
const isolatedEvidenceGeneration = isolated ? randomUUID() : undefined;
const viewerPortNumber = isolated?.viewerPort ?? parseStandaloneViewerPort(process.env.E2E_VIEWER_PORT ?? "5180");
const viewerPort = String(viewerPortNumber);
const viewerOrigin = isolated?.viewerOrigin ?? `http://127.0.0.1:${viewerPort}`;
const viewerBaseUrl =
  isolated?.viewerOrigin ?? (process.env.E2E_VIEWER_BASE_URL || viewerOrigin);
let viewerBaseOrigin: string;
try {
  viewerBaseOrigin = new URL(viewerBaseUrl).origin;
} catch {
  throw new Error("E2E_VIEWER_BASE_URL must be an absolute http(s) URL");
}
if (!/^https?:$/.test(new URL(viewerBaseUrl).protocol)) {
  throw new Error("E2E_VIEWER_BASE_URL must be an absolute http(s) URL");
}

const webServer = process.env.E2E_DISABLE_WEBSERVER === "1"
  ? []
  : [
      {
        command: isolated
          ? `npm exec -- vite --host 127.0.0.1 --port ${viewerPort} --strictPort`
          : `npm run dev -- --host 127.0.0.1 --port ${viewerPort} --strictPort`,
        url: viewerOrigin,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          VITE_VIEWER_HARNESS: isolated ? "0" : "1",
          VITE_COORDINATOR_API_BASE:
            isolated?.coordinatorBaseUrl || process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005",
          VITE_ALLOWED_COORDINATOR_ORIGINS:
            [...new Set([
              isolated?.coordinatorBaseUrl || process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8005",
              viewerOrigin,
              viewerBaseOrigin,
            ])].join(","),
        },
      },
    ];

// 前端 E2E 設定。
// - viewer dev server（預設 :5180，可由 E2E_VIEWER_PORT 覆寫）由 webServer 啟動；不 reuse 既有服務。
// - coordinator（:8004）視測試需要另行啟動（console / intake 類測試）；viewer harness 開機測試不需 coordinator。
// - 截圖 / trace / video 落在 repo 根 artifacts/e2e/_output（對齊任務指定路徑）。
// - harness 模式必須同時有 runner-owned VITE_VIEWER_HARNESS=1 與各測試的 ?harness=1。
export default defineConfig({
  metadata: isolated ? { isolatedEvidenceGeneration } : {},
  testDir: "./e2e",
  testIgnore: ["**/support/**/*.test.ts"],
  ...(isolated ? { testMatch: ["**/a3-federated-session-chain.spec.ts", "**/a4-closeout.spec.ts"] } : {}),
  globalSetup: isolated ? "./e2e/support/isolated-stack-global-setup.ts" : undefined,
  outputDir: isolated ? path.join(isolated.runDir, "playwright-output", isolatedEvidenceGeneration!) : "../artifacts/e2e/_output",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["./e2e/support/forbid-skipped-when-real.ts"],
    ["html", { outputFolder: isolated ? path.join(isolated.runDir, "playwright-report", isolatedEvidenceGeneration!) : "../artifacts/e2e/report", open: "never" }],
  ],
  use: {
    baseURL: viewerBaseUrl,
    trace: isolated ? "off" : "on",
    screenshot: isolated ? "off" : "on",
    video: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // 專用 E2E port（預設 5180，可用 E2E_VIEWER_PORT 隔離 parallel session；strictPort +
  // reuseExistingServer:false）：Playwright 每次起一台全新、確定是本 repo
  // 最新碼的 viewer dev server，避開被 docker 容器佔用的 5173/5174，杜絕「打到陳舊 server」的假象。
  // env：把 viewer 的 coordinator client base（build-time VITE_COORDINATOR_API_BASE，見
  // src/console/coordinatorClient.ts / src/config/env.ts）綁到 E2E_COORDINATOR_BASE_URL（缺省
  // http://127.0.0.1:8005 branch coordinator）。Vite 只把 VITE_* 從 dev server 進程 env 注入
  // import.meta.env，故必須在此 webServer 進程顯式注入，否則 env.ts 會 fallback :8004，browser POST
  // 打不到 :8005，conv-coverage-report / conv-prioritize-retry 兩支 spec 的真切片無法命中 branch coordinator。
  ...(webServer.length > 0 ? { webServer } : {}),
});
