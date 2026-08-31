import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig(baseConfig, {
  testMatch: ["**/session-idle-lifecycle.spec.ts"],
  use: {
    ...baseConfig.use,
    trace: "on",
    screenshot: "on",
    video: "off",
  },
});
