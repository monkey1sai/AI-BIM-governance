import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The default 5000ms boundary is too tight when external-ifc-ready.test.ts
    // runs in parallel with the new structured-log adapter tests (group 2 of
    // cross-service-structured-log-baseline) — env_snapshot persists ~100+ env
    // entries per logger construct, which is enough I/O contention under
    // Windows CI to push the IFC download flow past 5s. Local runs are sub-second.
    testTimeout: 20000,
  },
});
