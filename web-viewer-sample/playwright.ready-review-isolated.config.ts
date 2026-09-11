import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

// Uses the existing manifest, process-lineage setup and runner-owned viewer.
export default defineConfig(baseConfig, {
  testMatch: ["**/ready-review-isolated.spec.ts"],
});
