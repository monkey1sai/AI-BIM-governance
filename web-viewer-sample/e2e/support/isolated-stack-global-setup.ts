import { request } from "@playwright/test";
import { requireIsolatedStackConfig } from "./isolated-stack";

export default async function isolatedStackGlobalSetup(): Promise<void> {
  if (process.env.E2E_REQUIRE_REAL !== "1") return;
  const isolated = requireIsolatedStackConfig();
  const client = await request.newContext();
  try {
    if (process.env.E2E_DISABLE_WEBSERVER === "1") {
      const viewer = await client.get(isolated.viewerOrigin);
      if (!viewer.ok()) throw new Error(`external viewer probe failed: ${viewer.status()} ${isolated.viewerOrigin}`);
    }
    const coordinator = await client.get(`${isolated.coordinatorBaseUrl}/health`);
    if (!coordinator.ok()) {
      throw new Error(`coordinator probe failed: ${coordinator.status()} ${isolated.coordinatorBaseUrl}/health`);
    }
  } finally {
    await client.dispose();
  }
}
