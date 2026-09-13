import { defineConfig } from "@playwright/test";
import official from "./playwright.config";

// 使用正式 isolated global setup / webServer / forbidden-port guard；不允許 fallback mock。
export default defineConfig({
  ...official,
  testMatch: ["**/a1-delivery.spec.ts", "**/a1-remediation.spec.ts"],
});
