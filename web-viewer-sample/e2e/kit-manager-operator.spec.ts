import { expect, test } from "@playwright/test";

const coordinatorOrigin = "http://127.0.0.1:8006";
const kitManagerOrigin = "http://127.0.0.1:5194";

function instance(status: "open" | "closed") {
  return {
    instance_id: "kit_e2e_001",
    status,
    selected_artifact_ids: status === "open" ? ["artifact_1"] : [],
    opened_runtime_uris: status === "open" ? ["omniverse://fixture/model.usdc"] : [],
    last_command: status,
    control_status: status === "open" ? "open_command_accepted" : "close_command_accepted",
  };
}

test("Kit Manager uses the coordinator, sends operator auth, and renders mutation states", async ({ page }) => {
  const observed: Array<{ method: string; url: string; token?: string; body?: string | null }> = [];

  await page.route(`${coordinatorOrigin}/api/kit/**`, async (route) => {
    const request = route.request();
    const headers = request.headers();
    observed.push({
      method: request.method(),
      url: request.url(),
      token: headers["x-operator-token"],
      body: request.postData(),
    });
    const corsHeaders = {
      "access-control-allow-origin": kitManagerOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-operator-token",
      "content-type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders, body: "" });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path === "/api/kit/health") {
      await route.fulfill({ status: 200, headers: corsHeaders, json: { status: "ok", runtime_mode: "fixture", host_local_runtime_allowed: false, kit_instance_id: "kit_e2e_001", kit_control_url: "internal" } });
      return;
    }
    if (path === "/api/kit/usdc") {
      await route.fulfill({ status: 200, headers: corsHeaders, json: { items: [{ artifact_id: "artifact_1", filename: "model.usdc", relative_path: "fixture/model.usdc", runtime_uri: "omniverse://fixture/model.usdc", size_bytes: 2048 }] } });
      return;
    }
    if (path === "/api/kit/instances/current/open") {
      await route.fulfill({ status: 200, headers: corsHeaders, json: { instance: instance("open"), stage_composition_payload: {}, message: "Open accepted by coordinator fixture." } });
      return;
    }
    if (path === "/api/kit/instances/current/close") {
      await route.fulfill({ status: 200, headers: corsHeaders, json: { instance: instance("closed"), message: "Close accepted by coordinator fixture." } });
      return;
    }
    await route.fulfill({ status: 200, headers: corsHeaders, json: instance("closed") });
  });

  await page.goto("/");
  await expect(page.getByText("Kit Manager API 已連線。")).toBeVisible();
  await page.getByLabel("Operator token").fill("operator-e2e-token");
  await page.getByLabel(/model\.usdc/).check();
  await page.getByRole("button", { name: "Open selected in Kit" }).click();
  await expect(page.getByText("Open accepted by coordinator fixture.")).toBeVisible();
  await expect(page.getByText("kit_opened")).toBeVisible();

  await page.getByRole("button", { name: "Close instance" }).click();
  await expect(page.getByText("Close accepted by coordinator fixture.")).toBeVisible();
  await expect(page.getByText("kit_closed")).toBeVisible();

  const mutations = observed.filter((entry) => entry.method === "POST");
  expect(mutations).toHaveLength(2);
  expect(mutations.every((entry) => entry.token === "operator-e2e-token")).toBe(true);
  expect(JSON.parse(mutations[0].body || "{}")).toEqual({ artifact_ids: ["artifact_1"], replace_existing: true });
  expect(observed.some((entry) => /:8010(?:\/|$)/.test(entry.url))).toBe(false);
  expect(observed.filter((entry) => entry.method !== "OPTIONS").every((entry) => entry.url.startsWith(`${coordinatorOrigin}/api/kit/`))).toBe(true);
});
