import { expect, test } from "@playwright/test";

const MINIO_KEY = "松風庵/root/main/u1/model.ifc";
const MINIO_IDEMPOTENCY_KEY = "mw_0000000000000001";
const REVIEW_SESSION_ID = "review_session_x";
const NO_SESSION_JOB_ID = "ifcready_no_session";

function runtimeStatus(options?: { sessions?: Array<Record<string, unknown>> }) {
  const sessions = options?.sessions ?? [{
    session_id: REVIEW_SESSION_ID,
    status: "active",
    project_id: "p1",
    model_version_id: "v1",
    participant_count: 0,
    expected_stage_url: "stage://x",
    expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
    conversion_status: null,
    kit_instance_ids: [],
    created_at: "",
    updated_at: "",
    first_frame_at: null,
  }];

  return {
    service: { status: "ok", name: "coordinator", uptime_seconds: 1, generated_at: "" },
    configured_endpoints: {
      coordinator: { host: "127.0.0.1", port: 8004, public_host: "127.0.0.1", public_base_url: "http://127.0.0.1:8004" },
      viewer: { browser_url_base: "http://127.0.0.1:5180", handoff_path: "/" },
      governance_service: { base_url: "http://127.0.0.1:49102" },
      conversion_authority: { base_url: "http://127.0.0.1:49101", authority: "conversion-service" },
      kit: [],
    },
    sessions: {
      count: sessions.length,
      active_count: sessions.length,
      participant_count: 0,
      items: sessions,
    },
    kit_instance_bindings: [],
    ifc_ready_jobs: { count: 1, recent: [] },
    observations: {
      classification: "",
      note: "",
      web_plane: { coordinator_port: 8004, viewer_port: 5180 },
      host_native_plane: { conversion_api_base: "http://127.0.0.1:49101", kit_signal_ports: [] },
    },
  };
}

test("A1 MinIO downloaded job resolves to coordinator for-session rule-run", async ({ page }) => {
  let directRuleRunHit = false;
  let forSessionBody: unknown = null;

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/")) {
      await route.fulfill({ status: 599, json: { detail: `unexpected API request: ${url}` } });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/runtime/status", async (route) => {
    await route.fulfill({ json: runtimeStatus() });
  });
  await page.route("**/api/governance/files/tree", async (route) => {
    await route.fulfill({
      json: {
        root: "C:/Repos/active/iot/AI-BIM-governance/storage",
        source_kind: "local_fs",
        projects: [],
      },
    });
  });
  await page.route("**/api/minio/objects**", async (route) => {
    await route.fulfill({
      json: {
        bucket: "bim-control",
        count: 1,
        objects: [{
          key: MINIO_KEY,
          etag: "e",
          role: "source_ifc",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
          project_id: "p1",
          project_display_name: "松風庵",
          category: "建築",
          version: "v1",
        }],
      },
    });
  });
  await page.route("**/api/external/ifc-ready**", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        items: [{
          ifc_ready_job_id: "ifcready_1",
          status: "ready",
          project_id: "p1",
          external_model_version_id: "v1",
          download_status: "downloaded",
          conversion_status: "ready",
          conversion_authority: "conversion-service",
          queue_position: null,
          conversion_job_id: "conv_1",
          dispatch_error: null,
          review_session_id: REVIEW_SESSION_ID,
          viewer_url: null,
          expected_stage_url: "stage://x",
          expected_mapping_url: "http://127.0.0.1:49101/artifacts/demo/element_mapping.json",
          artifact_health: { source_ifc_exists: true },
          created_at: "2026-07-06T00:00:00+08:00",
          updated_at: "2026-07-06T00:00:01+08:00",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
          project_display_name: "松風庵",
          category: "建築",
        }],
      },
    });
  });
  await page.route(/\/api\/governance\/rule-runs\?.*$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    expect(url.pathname).toBe("/api/governance/rule-runs");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      limit: "5",
      project_id: "p1",
      model_category: "建築",
      model_version_id: "v1",
      ifc_ready_job_id: "ifcready_1",
      idempotency_key: MINIO_IDEMPOTENCY_KEY,
    });
    await route.fulfill({
      json: {
        filters: {
          project_id: "p1",
          model_category: "建築",
          model_version_id: "v1",
          ifc_ready_job_id: "ifcready_1",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
        },
        limit: 5,
        offset: 0,
        total: 0,
        items: [],
      },
    });
  });
  await page.route(`**/api/governance/rule-runs/for-session/${encodeURIComponent(REVIEW_SESSION_ID)}`, async (route) => {
    forSessionBody = route.request().postDataJSON();
    await route.fulfill({ json: { rule_run_id: "rr_a1", status: "queued" } });
  });
  await page.route("**/api/governance/rule-runs", async (route) => {
    directRuleRunHit = true;
    await route.fulfill({ status: 500, json: { detail: "direct rule-run must not be used for MinIO" } });
  });
  await page.route("**/api/governance/rule-runs/rr_a1", async (route) => {
    await route.fulfill({
      json: {
        rule_run_id: "rr_a1",
        status: "succeeded",
        score: 100,
        rule_set: "default",
        model_version_id: null,
        summary: { total: 1, passed: 1, failed: 0, errored: 0, target_summary: {}, warnings: [] },
      },
    });
  });
  await page.route("**/api/governance/rule-runs/rr_a1/results**", async (route) => {
    await route.fulfill({ json: { results: [] } });
  });

  await page.goto("/#a1-workbench");
  await page.getByTestId("a1-source-minio").click();
  await page.getByTestId("a1-minio-select").selectOption(MINIO_KEY);

  await expect(page.getByTestId("a1-minio-resolution-note")).toContainText(REVIEW_SESSION_ID);
  await expect(page.getByTestId("a1-step-pick")).toBeEnabled();
  await page.getByTestId("a1-step-pick").click();

  await expect(page.getByTestId("a1-step-run")).toBeEnabled();
  await expect(page.getByTestId("a1-session-select")).toHaveValue(REVIEW_SESSION_ID);
  await page.getByTestId("a1-step-run").click();

  await expect(page.getByTestId("a1-rulerun-scoreboard")).toBeVisible();
  expect(forSessionBody).toEqual({ ids_path: expect.stringContaining("sample-fire-rating.ids") });
  expect(directRuleRunHit).toBe(false);
  await expect(page.getByTestId("a1-minio-history-empty")).toBeVisible();
  await expect(page.getByTestId("a1-minio-history-error")).toHaveCount(0);

  await page.screenshot({ path: "../artifacts/e2e/a1-minio-local-resolution.png", fullPage: true });
});

test("A1 MinIO downloaded job without review session uses coordinator for-ifc-ready rule-run", async ({ page }) => {
  let directRuleRunHit = false;
  let forSessionHit = false;
  let forIfcReadyBody: unknown = null;

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/")) {
      await route.fulfill({ status: 599, json: { detail: `unexpected API request: ${url}` } });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/runtime/status", async (route) => {
    await route.fulfill({ json: runtimeStatus({ sessions: [] }) });
  });
  await page.route("**/api/governance/files/tree", async (route) => {
    await route.fulfill({
      json: {
        root: "C:/Repos/active/iot/AI-BIM-governance/storage",
        source_kind: "local_fs",
        projects: [],
      },
    });
  });
  await page.route("**/api/minio/objects**", async (route) => {
    await route.fulfill({
      json: {
        bucket: "bim-control",
        count: 1,
        objects: [{
          key: MINIO_KEY,
          etag: "e",
          role: "source_ifc",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
          project_id: "p1",
          project_display_name: "松風庵",
          category: "建築",
          version: "v1",
        }],
      },
    });
  });
  await page.route("**/api/external/ifc-ready**", async (route) => {
    await route.fulfill({
      json: {
        count: 1,
        items: [{
          ifc_ready_job_id: NO_SESSION_JOB_ID,
          status: "ready",
          project_id: "p1",
          external_model_version_id: "v1",
          download_status: "downloaded",
          conversion_status: "pending",
          conversion_authority: "conversion-service",
          queue_position: null,
          conversion_job_id: null,
          dispatch_error: null,
          review_session_id: null,
          viewer_url: null,
          expected_stage_url: null,
          expected_mapping_url: null,
          artifact_health: { source_ifc_exists: true },
          created_at: "2026-07-06T00:00:00+08:00",
          updated_at: "2026-07-06T00:00:01+08:00",
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
          project_display_name: "松風庵",
          category: "建築",
        }],
      },
    });
  });
  await page.route(/\/api\/governance\/rule-runs\?.*$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const url = new URL(route.request().url());
    expect(url.pathname).toBe("/api/governance/rule-runs");
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      limit: "5",
      project_id: "p1",
      model_category: "建築",
      model_version_id: "v1",
      ifc_ready_job_id: NO_SESSION_JOB_ID,
      idempotency_key: MINIO_IDEMPOTENCY_KEY,
    });
    await route.fulfill({
      json: {
        filters: {
          project_id: "p1",
          model_category: "建築",
          model_version_id: "v1",
          ifc_ready_job_id: NO_SESSION_JOB_ID,
          idempotency_key: MINIO_IDEMPOTENCY_KEY,
        },
        limit: 5,
        offset: 0,
        total: 0,
        items: [],
      },
    });
  });
  await page.route(`**/api/governance/rule-runs/for-ifc-ready/${encodeURIComponent(NO_SESSION_JOB_ID)}`, async (route) => {
    forIfcReadyBody = route.request().postDataJSON();
    await route.fulfill({ json: { rule_run_id: "rr_ifc_ready", status: "queued" } });
  });
  await page.route("**/api/governance/rule-runs/for-session/**", async (route) => {
    forSessionHit = true;
    await route.fulfill({ status: 500, json: { detail: "for-session must not be used without a review session" } });
  });
  await page.route("**/api/governance/rule-runs", async (route) => {
    directRuleRunHit = true;
    await route.fulfill({ status: 500, json: { detail: "direct rule-run must not be used for MinIO" } });
  });
  await page.route("**/api/governance/rule-runs/rr_ifc_ready", async (route) => {
    await route.fulfill({
      json: {
        rule_run_id: "rr_ifc_ready",
        status: "succeeded",
        score: 100,
        rule_set: "default",
        model_version_id: null,
        summary: { total: 1, passed: 1, failed: 0, errored: 0, target_summary: {}, warnings: [] },
      },
    });
  });
  await page.route("**/api/governance/rule-runs/rr_ifc_ready/results**", async (route) => {
    await route.fulfill({ json: { results: [] } });
  });

  await page.goto("/#a1-workbench");
  await page.getByTestId("a1-source-minio").click();
  await page.getByTestId("a1-minio-select").selectOption(MINIO_KEY);

  await expect(page.getByTestId("a1-minio-resolution-note")).toContainText(NO_SESSION_JOB_ID);
  await expect(page.getByTestId("a1-minio-resolution-note")).toContainText("ifc-ready proxy");
  await expect(page.getByTestId("a1-step-pick")).toBeEnabled();
  await page.getByTestId("a1-step-pick").click();

  await expect(page.getByTestId("a1-step-run")).toBeEnabled();
  await expect(page.getByTestId("a1-session-select")).toHaveCount(0);
  await page.getByTestId("a1-step-run").click();

  await expect(page.getByTestId("a1-rulerun-scoreboard")).toBeVisible();
  expect(forIfcReadyBody).toEqual({ ids_path: expect.stringContaining("sample-fire-rating.ids") });
  expect(directRuleRunHit).toBe(false);
  expect(forSessionHit).toBe(false);
  await expect(page.getByTestId("a1-minio-history-empty")).toBeVisible();
  await expect(page.getByTestId("a1-minio-history-error")).toHaveCount(0);

  await page.screenshot({ path: "../artifacts/e2e/a1-minio-local-resolution-no-session.png", fullPage: true });
});
