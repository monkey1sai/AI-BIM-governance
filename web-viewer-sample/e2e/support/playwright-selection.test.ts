import { afterEach, expect, it, vi } from "vitest";

vi.mock("./isolated-stack", () => ({
  loadIsolatedStackConfig: () => ({ viewerPort: 5180, viewerOrigin: "http://127.0.0.1:5180",
    coordinatorBaseUrl: "http://127.0.0.1:8005", runDir: "fixture-run" }),
  parseStandaloneViewerPort: Number,
}));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it.each([false, true])("A1 discovery requires its owner-prepared fixture: %s", async hasFixture => {
  vi.stubEnv("A1_REMEDIATION_E2E_FIXTURE", hasFixture ? "library-fixture.json" : "");
  const config = (await import("../../playwright.config")).default;
  expect(config.testMatch).toEqual([
    ...(hasFixture ? ["**/a1-remediation.spec.ts"] : []),
    "**/a3-federated-session-chain.spec.ts", "**/a4-closeout.spec.ts",
  ]);
});
