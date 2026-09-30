import { expect, test } from "@playwright/test";
import { loadIsolatedStackConfig, watchForbiddenRequests } from "./support/isolated-stack";

const isolated = loadIsolatedStackConfig();

test.describe("Ready review isolated stack", () => {
test.skip(!isolated, "Requires E2E_REQUIRE_REAL=1 and an owned stack manifest");
if (!isolated) return;
test("isolated A1 exposes an honest empty model state without creating a session", async ({page, request}, testInfo) => {
  const forbidden = watchForbiddenRequests(page, isolated.coordinatorBaseUrl);
  const before = await (await request.get(isolated.coordinatorBaseUrl + "/api/runtime/status")).json();
  const posts: string[] = [];
  page.on("request", req => { if (req.method() === "POST" && req.url().includes("/review-session")) posts.push(req.url()); });
  await page.goto(isolated.viewerOrigin + "/#a1-workbench");
  await expect(page.getByTestId("model-file-empty")).toBeVisible();
  await expect(page.getByTestId("model-file-list").locator("[data-testid^='model-file-create-']")).toHaveCount(0);
  await page.getByRole("button", {name: "重新整理", exact: true}).click();
  await expect(page.getByTestId("model-file-empty")).toBeVisible();
  const after = await (await request.get(isolated.coordinatorBaseUrl + "/api/runtime/status")).json();
  expect(after.sessions.items).toEqual(before.sessions.items);
  expect(posts).toEqual([]);
  await page.screenshot({path: testInfo.outputPath("ready-review-isolated-empty.png"), fullPage: true});
  forbidden.assertClean();
});
});
