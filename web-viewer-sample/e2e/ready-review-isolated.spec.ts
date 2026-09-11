import { expect, test } from "@playwright/test";
import { requireIsolatedStackConfig, watchForbiddenRequests } from "./support/isolated-stack";

const isolated = requireIsolatedStackConfig();

test("isolated A1 exposes an honest empty model state without creating a session", async ({page, request}, testInfo) => {
  const forbidden = watchForbiddenRequests(page, isolated.coordinatorBaseUrl);
  const before = await (await request.get(isolated.coordinatorBaseUrl + "/api/runtime/status")).json();
  const posts: string[] = [];
  page.on("request", req => { if (req.method() === "POST" && req.url().includes("/review-session")) posts.push(req.url()); });
  await page.goto(isolated.viewerOrigin + "/#a1-workbench");
  await expect(page.getByTestId("ready-review-sessions")).toContainText("尚無可審查模型");
  await expect(page.getByTestId("ready-review-create")).toBeDisabled();
  await page.getByRole("button", {name: "重新整理模型", exact: true}).click();
  await expect(page.getByTestId("ready-review-sessions")).toContainText("尚無可審查模型");
  const after = await (await request.get(isolated.coordinatorBaseUrl + "/api/runtime/status")).json();
  expect(after.sessions.items).toEqual(before.sessions.items);
  expect(posts).toEqual([]);
  await page.screenshot({path: testInfo.outputPath("ready-review-isolated-empty.png"), fullPage: true});
  forbidden.assertClean();
});
