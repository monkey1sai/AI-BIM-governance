import { expect, test, type Page } from "@playwright/test";

const CONSOLE_BASE = (process.env.E2E_CONSOLE_BASE_URL || "http://127.0.0.1:5180").replace(/\/$/, "");
const ARTIFACT_DIR = "../artifacts/e2e/infra-slice";

const sourceKey = "model.ifc";
const idempotencyKey = "mw_infrae2e0000001";

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function runtimeStatus() {
  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 10, generated_at: iso(0) },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5180", handoff_path: "/" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "local" },
      kit: [],
    },
    sessions: {
      count: 2,
      active_count: 1,
      participant_count: 1,
      items: [
        {
          session_id: "review_session_infra",
          status: "active",
          project_id: "p1",
          model_version_id: "v1",
          participant_count: 1,
          expected_stage_url: "omniverse://infra/model.usd",
          conversion_status: "ready",
          kit_instance_ids: ["kit_main"],
          created_at: iso(-60_000),
          updated_at: iso(-1_000),
          primary_viewer_lease_id: "lease_infra",
          first_frame_at: iso(-5_000),
          viewer_leases: [{
            lease_id: "lease_infra",
            viewer_id: "viewer_infra",
            user_id: "operator",
            display_name: "operator",
            role: "primary",
            status: "active",
            claimed_at: iso(-10_000),
            last_heartbeat_at: iso(-1_000),
            released_at: null,
            first_frame_at: iso(-5_000),
            loaded_stage_url: "omniverse://infra/model.usd",
            datachannel_ready: true,
            stage_match: true,
          }],
        },
        {
          session_id: "review_session_created",
          status: "created",
          project_id: "p1",
          model_version_id: "v2",
          participant_count: 0,
          expected_stage_url: null,
          conversion_status: null,
          kit_instance_ids: [],
          created_at: iso(-30_000),
          updated_at: iso(-30_000),
        },
      ],
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 0, recent: [] },
    observations: {
      classification: "asbuilt",
      note: "playwright infra-slice stub",
      web_plane: { coordinator_port: 8004, viewer_port: 5180 },
      host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [49100], kit_media_ports: [47998] },
    },
  };
}

const kitInstance = {
  instance_id: "kit_main",
  status: "open",
  selected_artifact_ids: [idempotencyKey],
  opened_runtime_uris: ["omniverse://infra/model.usd"],
  last_command: "open",
  control_status: "sent",
};

const minioObject = {
  key: sourceKey,
  etag: "etag-infra",
  role: "source_ifc",
  project_id: "p1",
  project_display_name: "洲際好宅",
  category: "建築-JTest",
  version: "b15653e5-0002-4fd3-a186-cf1d9b237b68",
  idempotency_key: idempotencyKey,
};

const conversionRecord = {
  idempotency_key: idempotencyKey,
  project_id: "p1",
  project_display_name: "洲際好宅",
  category: "建築-JTest",
  external_model_version_id: "b15653e5-0002-4fd3-a186-cf1d9b237b68",
  conversion_job_id: "conv_infra",
  status: "ready",
  usdc_key: "model.usdc",
  coverage_report: {
    coverage_ratio: 1,
    coverage_status: "pass",
    mapped_count: 10,
    unmapped_count: 0,
    materialization_strategy: "usd_stage_enumeration",
  },
  object_key: sourceKey,
  detected_at: iso(-120_000),
  updated_at: iso(-60_000),
};

async function stubInfraApis(page: Page): Promise<void> {
  await page.route("**/api/runtime/status", (route) => route.fulfill({ json: runtimeStatus() }));
  await page.route("**/api/kit/instances/current", (route) => route.fulfill({ json: kitInstance }));
  await page.route("**/api/external/ifc-ready**", (route) => route.fulfill({ json: { count: 0, items: [] } }));
  await page.route("**/api/external/minio-watch/status", (route) => route.fulfill({ json: { enabled: true, bucket: "bim-control", prefix: "", poll_count: 1, last_error: null } }));
  await page.route("**/api/conversion/records**", (route) => route.fulfill({ json: { count: 1, items: [conversionRecord] } }));
  await page.route("**/api/dev/conversions", (route) => route.fulfill({ json: { count: 0, items: [] } }));
  await page.route("**/api/minio/objects**", (route) => route.fulfill({
    json: {
      bucket: "bim-control",
      prefix: "",
      folders: [],
      objects: [minioObject],
      count: 1,
      cache: { hit: false },
    },
  }));
}

async function gotoConsole(page: Page, route: string): Promise<void> {
  await page.goto(`${CONSOLE_BASE}/#/${route}`);
}

test.describe("infra capability slice evidence", () => {
  test.beforeEach(async ({ page }) => {
    await stubInfraApis(page);
  });

  test("#sessions shows evidence columns and A1 bridge supply", async ({ page }) => {
    await gotoConsole(page, "sessions");
    await expect(page.getByTestId("a1-bridge-supply")).toBeVisible();
    await expect(page.getByTestId("ev-first-frame").first()).not.toContainText("未取得");
    await expect(page.getByTestId("ev-heartbeat").first()).not.toContainText("未取得");
    await expect(page.getByTestId("ev-heartbeat").first()).not.toContainText("stale");
    await expect(page.getByTestId("ev-stage").first()).toContainText("matched");
    await page.screenshot({ path: `${ARTIFACT_DIR}/sessions-evidence-bridge.png`, fullPage: true });
  });

  test("#minio ObjectDetailPane shows ledger coverage_report", async ({ page }) => {
    await gotoConsole(page, "minio");
    await page.getByTestId(`md-tree-select-${idempotencyKey}`).click();
    await expect(page.getByTestId("md-ledger-coverage")).toContainText("100%");
    await expect(page.getByTestId("md-ledger-coverage")).toContainText("pass");
    await page.screenshot({ path: `${ARTIFACT_DIR}/minio-ledger-coverage.png`, fullPage: true });
  });

  test("#instances shows live kit instance and no edge-gpu demo rows", async ({ page }) => {
    await gotoConsole(page, "instances");
    await expect(page.getByTestId("kg-live-instance")).toContainText("kit_main");
    await expect(page.getByTestId("kg-live-instance")).toContainText("omniverse://infra/model.usd");
    await expect(page.getByText("edge-gpu-01")).toHaveCount(0);
    await page.screenshot({ path: `${ARTIFACT_DIR}/instances-live-kit.png`, fullPage: true });
  });

  test("#runtime shows monitoring summary", async ({ page }) => {
    await gotoConsole(page, "runtime");
    await expect(page.getByTestId("rt-monitor-summary")).toContainText("active 1");
    await expect(page.getByTestId("rt-monitor-summary")).toContainText("created 1");
    await expect(page.getByTestId("rt-monitor-summary")).toContainText("kit_main · open");
    await page.screenshot({ path: `${ARTIFACT_DIR}/runtime-monitor-summary.png`, fullPage: true });
  });
});
