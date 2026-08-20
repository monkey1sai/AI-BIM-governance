import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig(baseConfig, {
  testMatch: ["conv-history.spec.ts"],
  outputDir: "../artifacts/e2e/functional-runtime/_output",
  reporter: [["list"], ["./e2e/support/forbid-skipped-when-real.ts"]],
  use: {
    ...baseConfig.use,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
