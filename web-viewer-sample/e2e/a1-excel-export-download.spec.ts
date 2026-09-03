import { expect, test, type Page } from "@playwright/test";
import { inflateRawSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_XLSX = path.join(TEST_DIR, "fixtures", "rule-run-rr_a1.xlsx");
const MINIO_KEY = "松風庵/root/main/u1/model.ifc";
const MINIO_IDEMPOTENCY_KEY = "mw_0000000000000001";
const REVIEW_SESSION_ID = "review_session_x";
const RUN_ID = "rr_a1";
const EXPECTED_HEADERS = [
  "rule_code",
  "severity",
  "ifc_type",
  "ifc_name",
  "ifc_guid",
  "usd_prim_path",
  "message",
] as const;

function runtimeStatus() {
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
      count: 1,
      active_count: 1,
      participant_count: 0,
      items: [{
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
      }],
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

function readZipUtf8(buf: Buffer, entryName: string): string {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (name === entryName || name.endsWith(`/${entryName}`)) {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data).toString("utf8");
      throw new Error(`unsupported zip method ${method} for ${name}`);
    }
    offset = dataStart + compSize;
  }
  throw new Error(`zip entry not found: ${entryName}`);
}

async function installA1Mocks(page: Page, exportStatus: number): Promise<void> {
  const xlsx = fs.readFileSync(FIXTURE_XLSX);
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
    await route.fulfill({ json: { root: "C:/tmp/storage", source_kind: "local_fs", projects: [] } });
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
  await page.route(`**/api/governance/rule-runs/for-session/${encodeURIComponent(REVIEW_SESSION_ID)}`, async (route) => {
    await route.fulfill({ json: { rule_run_id: RUN_ID, status: "queued" } });
  });
  await page.route("**/api/governance/rule-runs", async (route) => {
    await route.fulfill({ json: { items: [], filters: {}, limit: 20, offset: 0 } });
  });
  await page.route(`**/api/governance/rule-runs/${RUN_ID}/export**`, async (route) => {
    if (exportStatus !== 200) {
      await route.fulfill({ status: exportStatus, json: { detail: "export failed" } });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "Content-Disposition": `attachment; filename="rule-run-${RUN_ID}.xlsx"` },
      body: xlsx,
    });
  });
  await page.route(`**/api/governance/rule-runs/${RUN_ID}/results**`, async (route) => {
    await route.fulfill({ json: { results: [] } });
  });
  await page.route(`**/api/governance/rule-runs/${RUN_ID}`, async (route) => {
    await route.fulfill({
      json: {
        rule_run_id: RUN_ID,
        status: "succeeded",
        score: 80,
        rule_set: "default",
        model_version_id: "v1",
        summary: { total: 2, passed: 1, failed: 1, errored: 0, target_summary: {}, warnings: [] },
      },
    });
  });
}

async function reachScoredExport(page: Page): Promise<void> {
  await page.goto("/#a1-workbench");
  await page.getByTestId("a1-source-minio").click();
  await page.getByTestId("a1-minio-select").selectOption(MINIO_KEY);
  await expect(page.getByTestId("a1-step-pick")).toBeEnabled();
  await page.getByTestId("a1-step-pick").click();
  await expect(page.getByTestId("a1-step-run")).toBeEnabled();
  await page.getByTestId("a1-step-run").click();
  await expect(page.getByTestId("a1-rulerun-scoreboard")).toBeVisible();
  await expect(page.getByTestId("a1-step-export")).toBeEnabled();
}

test.describe("A1 Excel export browser download", () => {
  test("success: browser download is a real xlsx with Failed Elements headers", async ({ page }, testInfo) => {
    await installA1Mocks(page, 200);
    await reachScoredExport(page);

    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await page.getByTestId("a1-step-export").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`rule-run-${RUN_ID}.xlsx`);
    await expect(page.getByTestId("a1-exported-artifact")).toBeVisible();
    await expect(page.getByTestId("a1-action-error")).toHaveCount(0);

    const dest = testInfo.outputPath(`rule-run-${RUN_ID}.xlsx`);
    await download.saveAs(dest);
    const bytes = fs.readFileSync(dest);
    expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const sheet = readZipUtf8(bytes, "xl/worksheets/sheet1.xml");
    for (const header of EXPECTED_HEADERS) {
      expect(sheet, `xlsx Failed Elements sheet missing ${header}`).toContain(header);
    }
    const workbook = readZipUtf8(bytes, "xl/workbook.xml");
    expect(workbook).toContain("Failed Elements");
    expect(workbook).toContain("Summary");
    await page.screenshot({ path: testInfo.outputPath("a1-excel-export-success.png"), fullPage: true });
  });

  test("server 500: UI shows HTTP error, no download, no success artifact", async ({ page }) => {
    await installA1Mocks(page, 500);
    await reachScoredExport(page);

    let sawDownload = false;
    page.once("download", () => { sawDownload = true; });
    await page.getByTestId("a1-step-export").click();
    await expect(page.getByTestId("a1-action-error")).toContainText(/HTTP 500/);
    await expect(page.getByTestId("a1-exported-artifact")).toHaveCount(0);
    await expect.poll(() => sawDownload, { timeout: 2_000 }).toBe(false);
  });
});
