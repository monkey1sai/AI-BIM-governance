// model-file-session-lifecycle-contract §4.1（GET 擴充）與 §4.4（DELETE，Task 9 追加）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createCoordinatorApp, type CoordinatorApp } from "../src/app.js";
import type { CoordinatorConfig } from "../src/config.js";
import type { ExternalIfcReadyEvent } from "../src/types.js";

let active: CoordinatorApp | null = null;
let root: string | null = null;

const READY_KEY = "mw_aaaa0000bbbb0001";
function ledgerRecord(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: READY_KEY, correlation_id: "minio-watch-aa000001", project_id: "proj_a",
    project_display_name: "專案A", category: "建築", external_model_version_id: "v1",
    object_key: "proj_a/建築/v1/model.ifc", bucket: "bim-control", conversion_job_id: "stream_conv_a",
    status: "ready", coverage_report: null, usdc_key: "proj_a/建築/v1/model.usdc",
    detected_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", ...overrides,
  };
}
function makeApp(ledgerRecords: unknown[], overrides: Partial<CoordinatorConfig> = {}): CoordinatorApp {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "conv-record-remove-"));
  const ledgerPath = path.join(root, "conversion-ledger.json");
  fs.writeFileSync(ledgerPath, JSON.stringify({ schema_version: "conversion-ledger/v2", records: ledgerRecords }, null, 2), "utf-8");
  active = createCoordinatorApp({
    sessionStoreDir: path.join(root, "sessions"), eventLogDir: path.join(root, "events"),
    callbackOutboxStorePath: path.join(root, "callback-outbox.json"), conversionLedgerStorePath: ledgerPath,
    corsOrigins: ["http://127.0.0.1:5173"], conversionPollEnabled: false, minioWatchBucket: "bim-control", ...overrides,
  });
  return active;
}
afterEach(async () => {
  if (active) { await active.dispose(); active.io.close(); await new Promise<void>((r) => active?.server.close(() => r())); active = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
async function createBoundSession(app: CoordinatorApp, suffix: string, conversionJobId: string, filename?: string): Promise<string> {
  const created = await request(app.app).post("/api/review-sessions").send({
    project_id: `project_${suffix}`, model_version_id: `model_${suffix}`,
    artifact_bindings: [{ artifact_group_id: `group_${suffix}`, artifact_id: `artifact_${suffix}`, artifact_role: "derived",
      url: `http://127.0.0.1:49101/artifacts/${suffix}/model.usdc`, mapping_url: null, load_order: 0, ready_status: "ready",
      conversion_authority: "bim-streaming-server", conversion_job_id: conversionJobId, source_ifc_filename: filename ?? null }],
  });
  expect(created.status).toBe(200);
  return created.body.session_id as string;
}
function createIntakeJob(app: CoordinatorApp, idempotencyKey: string, filename: string | null, reviewSessionId?: string) {
  const event: ExternalIfcReadyEvent = {
    event: "ifc_ready", tenant_id: "tenant_t", project_id: "project_t", external_model_version_id: "version_t",
    external_conversion_task_id: null, source_ifc: { ref: "http://127.0.0.1:1/t.ifc", etag: "etag_t", filename }, callback_url: null,
  };
  const job = app.externalIfcReadyStore.create(event, { correlationId: `corr_${idempotencyKey}`, idempotencyKey,
    tenantId: "tenant_t", projectId: "project_t", externalModelVersionId: "version_t" });
  if (reviewSessionId) app.externalIfcReadyStore.recordReviewSession(job.ifc_ready_job_id, reviewSessionId);
  return job;
}

describe("GET /api/conversion/records with sessions[] and source_ifc_filename", () => {
  it("links sessions by artifact binding and reports the object_key filename", async () => {
    const app = makeApp([ledgerRecord()]);
    const sessionId = await createBoundSession(app, "a", "stream_conv_a");
    const res = await request(app.app).get("/api/conversion/records");
    expect(res.status).toBe(200);
    expect(res.body.items[0].source_ifc_filename).toBe("model.ifc");
    expect(res.body.items[0].sessions).toEqual([expect.objectContaining({ session_id: sessionId, link: "artifact_binding" })]);
  });

  it("falls back to the intake job filename when object_key is null", async () => {
    const app = makeApp([ledgerRecord({ idempotency_key: "idem_devreg_1", object_key: null, bucket: null })]);
    createIntakeJob(app, "idem_devreg_1", "villa.ifc");
    const res = await request(app.app).get("/api/conversion/records");
    expect(res.body.items[0]).toMatchObject({ source_ifc_filename: "villa.ifc", sessions: [] });
  });

  it("hides removed records unless include_removed=1", async () => {
    const app = makeApp([ledgerRecord(), ledgerRecord({ idempotency_key: "mw_aaaa0000bbbb0002", conversion_job_id: "stream_conv_b",
      status: "removed", removed_at: "2026-09-02T00:00:00.000Z", removed_by: "op" })]);
    const hidden = await request(app.app).get("/api/conversion/records");
    expect(hidden.body.count).toBe(1);
    expect(hidden.body.items.map((item: { idempotency_key: string }) => item.idempotency_key)).toEqual([READY_KEY]);
    const shown = await request(app.app).get("/api/conversion/records?include_removed=1");
    expect(shown.body.count).toBe(2);
    expect(shown.body.items.find((item: { idempotency_key: string }) => item.idempotency_key === "mw_aaaa0000bbbb0002"))
      .toMatchObject({ status: "removed", removed_at: "2026-09-02T00:00:00.000Z", removed_by: "op" });
  });
});
